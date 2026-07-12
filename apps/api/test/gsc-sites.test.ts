/**
 * Phase 2.6 — GSC property listing + selection over real HTTP + Postgres.
 * The authenticated transport is a port; a fixture stands in (no network).
 * Selecting a property persists it on the connection and schedules ingestion
 * (reuses scheduleWorkspaceJob → scheduler → queue → pipeline).
 */
import { join } from "node:path";
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdapterError, FixtureGscTransport, type GoogleTokenEndpoint } from "@aigos/adapters";
import { Delivery, NotificationTypeRegistry } from "@aigos/delivery";
import { MagicLinkService, SessionService } from "@aigos/identity";
import { TokenVault, provisionOnSignIn } from "@aigos/database";

import { createApiServer } from "../src/server.js";
import { startHarness, type Harness } from "../../../packages/database/test/harness.js";

const FIXTURES = join(__dirname, "..", "..", "..", "packages", "adapters", "src", "gsc", "fixtures");

let h: Harness;
let server: Server;
let base: string;
let sid = "";
let workspaceId = "";
let connectionId = "";

const endpoint: GoogleTokenEndpoint = {
  exchangeCode: async () => ({ accessToken: "ya29.INITIAL", refreshToken: "1//R", expiresInSeconds: 3600 }),
  refreshToken: async () => ({ accessToken: "ya29.REFRESHED", expiresInSeconds: 3600 }),
};

beforeAll(async () => {
  h = await startHarness();
  const sessions = new SessionService(h.app, () => new Date());
  const registry = new NotificationTypeRegistry();
  registry.register({ type: "security_transactional", channel: "email", dailyBudget: 0, cooldownSeconds: 0, budgetExempt: true });
  const delivery = new Delivery({ registry, channels: [{ channel: "email", send: async () => {} }], ledger: async () => {}, clock: () => new Date() });
  const vault = new TokenVault(h.vault, { encryptionKeyHex: "c".repeat(64), keyId: "k1" }, () => new Date());
  server = createApiServer({
    pool: h.app,
    magic: new MagicLinkService(h.app, delivery, () => new Date(), { baseUrl: "https://x" }),
    sessions,
    googleOAuth: {
      clientId: "c", redirectUri: "https://app.test/connections/google/callback",
      stateHmacKey: "hmac", endpoint, vault,
      gscTransport: () => new FixtureGscTransport(FIXTURES), // authenticated in prod; fixture here
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "string" || !addr) throw new Error("no addr");
  base = `http://127.0.0.1:${addr.port}`;

  const me = await provisionOnSignIn(h.app, "halim@test.dev");
  workspaceId = me.workspaces[0]!.id;
  sid = (await sessions.issue(me.userId, "node-other", "127.0.0.1")).sessionId;

  // Connect GSC through the existing OAuth flow (no site chosen yet).
  const authorize = await get(`/connections/google/authorize?workspaceId=${workspaceId}`);
  const state = new URL(((await authorize.json()) as { url: string }).url).searchParams.get("state")!;
  const cb = await get(`/connections/google/callback?code=x&state=${encodeURIComponent(state)}`);
  connectionId = (JSON.parse(await cb.text()) as { connection: { id: string } }).connection.id;
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await h.stop();
});

function get(path: string) {
  return fetch(`${base}${path}`, { headers: { "user-agent": "node", cookie: `sid=${sid}` }, redirect: "manual" });
}
function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf": "1", "user-agent": "node", cookie: `sid=${sid}`, ...headers },
    body: JSON.stringify(body),
  });
}

describe("GET /connections/google/sites", () => {
  it("lists only verified properties (unverified filtered out)", async () => {
    const res = await get(`/connections/google/sites?workspaceId=${workspaceId}&connectionId=${connectionId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sites: { siteUrl: string; permissionLevel: string }[] };
    expect(body.sites.map((s) => s.siteUrl)).toEqual(["sc-domain:forgcv.com", "https://blog.forgcv.com/"]);
    expect(body.sites.some((s) => s.permissionLevel === "siteUnverifiedUser")).toBe(false);
  });

  it("403 for a non-member workspace mismatch; 401 unauthenticated", async () => {
    const foreign = await fetch(`${base}/connections/google/sites?workspaceId=${crypto.randomUUID()}&connectionId=${connectionId}`, {
      headers: { "user-agent": "node", cookie: `sid=${sid}` },
    });
    expect(foreign.status).toBe(403);
    const anon = await fetch(`${base}/connections/google/sites?workspaceId=${workspaceId}&connectionId=${connectionId}`, {
      headers: { "user-agent": "node" },
    });
    expect(anon.status).toBe(401);
  });
});

describe("POST /connections/google/site", () => {
  it("persists the chosen property on the connection and schedules ingestion", async () => {
    const res = await post("/connections/google/site", { workspaceId, connectionId, siteUrl: "sc-domain:forgcv.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scheduled: true });

    const conn = await h.admin.query(`SELECT external_account_ref FROM connections WHERE id = $1`, [connectionId]);
    expect(conn.rows[0].external_account_ref).toBe("sc-domain:forgcv.com");

    const job = await h.admin.query(
      `SELECT enabled, params FROM scheduled_jobs WHERE workspace_id = $1 AND job_family = 'gsc.ingest.daily'`,
      [workspaceId],
    );
    expect(job.rowCount).toBe(1);
    expect(job.rows[0].enabled).toBe(true);
    expect(job.rows[0].params).toMatchObject({ workspaceId, connectionId, siteUrl: "sc-domain:forgcv.com" });
    const audit = await h.admin.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE event = 'connection.site_selected' AND workspace_id = $1`, [workspaceId],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it("selecting the same property again is idempotent (no duplicate schedule)", async () => {
    await post("/connections/google/site", { workspaceId, connectionId, siteUrl: "sc-domain:forgcv.com" });
    const job = await h.admin.query(
      `SELECT count(*)::int AS n FROM scheduled_jobs WHERE workspace_id = $1 AND job_family = 'gsc.ingest.daily'`,
      [workspaceId],
    );
    expect(job.rows[0].n).toBe(1);
  });

  it("requires CSRF and rejects an empty site", async () => {
    const noCsrf = await fetch(`${base}/connections/google/site`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "node", cookie: `sid=${sid}` },
      body: JSON.stringify({ workspaceId, connectionId, siteUrl: "sc-domain:forgcv.com" }),
    });
    expect(noCsrf.status).toBe(403);
    const empty = await post("/connections/google/site", { workspaceId, connectionId, siteUrl: "" });
    expect(empty.status).toBe(400);
  });
});

describe("provider auth failure surfaces honestly", () => {
  it("a refresh auth failure marks the connection expired and returns 401", async () => {
    const failing: GoogleTokenEndpoint = {
      exchangeCode: async () => ({ accessToken: "a", refreshToken: "1//R", expiresInSeconds: -10 }),
      refreshToken: async () => {
        throw new AdapterError("auth", "invalid_grant");
      },
    };
    const vault = new TokenVault(h.vault, { encryptionKeyHex: "d".repeat(64), keyId: "k2" }, () => new Date());
    const reg = new NotificationTypeRegistry();
    reg.register({ type: "security_transactional", channel: "email", dailyBudget: 0, cooldownSeconds: 0, budgetExempt: true });
    const del = new Delivery({ registry: reg, channels: [{ channel: "email", send: async () => {} }], ledger: async () => {}, clock: () => new Date() });
    const srv = createApiServer({
      pool: h.app,
      magic: new MagicLinkService(h.app, del, () => new Date(), { baseUrl: "https://x" }),
      sessions: new SessionService(h.app, () => new Date()),
      googleOAuth: {
        clientId: "c", redirectUri: "https://app.test/cb", stateHmacKey: "hmac",
        endpoint: failing, vault, gscTransport: () => new FixtureGscTransport(FIXTURES),
      },
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const addr = srv.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    // seed an expired-token connection directly through the vault
    await vault.storeTokens(workspaceId, connectionId, { accessToken: "old", refreshToken: "1//R", expiresAt: new Date(Date.now() - 3600_000) });
    const res = await fetch(`http://127.0.0.1:${port}/connections/google/sites?workspaceId=${workspaceId}&connectionId=${connectionId}`, {
      headers: { "user-agent": "node", cookie: `sid=${sid}` },
    });
    expect(res.status).toBe(401);
    const conn = await h.admin.query(`SELECT status FROM connections WHERE id = $1`, [connectionId]);
    expect(conn.rows[0].status).toBe("expired");
    await new Promise<void>((resolve, reject) => srv.close((e) => (e ? reject(e) : resolve())));
  });
});
