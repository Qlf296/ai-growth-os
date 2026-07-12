/**
 * Phase 2.4 — /connections/google routes over real HTTP + Postgres.
 * ADR-019: workspace-owned, authorized_by = the session user.
 * I8: no token material ever appears in any response body.
 */
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdapterError, type GoogleTokenEndpoint } from "@aigos/adapters";
import { Delivery, NotificationTypeRegistry } from "@aigos/delivery";
import { MagicLinkService, SessionService } from "@aigos/identity";
import { TokenVault, provisionOnSignIn } from "@aigos/database";

import { createApiServer } from "../src/server.js";
import { startHarness, type Harness } from "../../../packages/database/test/harness.js";

let h: Harness;
let server: Server;
let base: string;
let sid = "";
let sidOther = "";
let myWorkspaceId = "";
let vault: TokenVault;

const endpoint: GoogleTokenEndpoint = {
  exchangeCode: async (code) => {
    if (code !== "good-code") throw new AdapterError("auth", "invalid_grant");
    return {
      accessToken: "ya29.SECRET-ACCESS",
      refreshToken: "1//SECRET-REFRESH",
      expiresInSeconds: 3600,
      grantedScopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    };
  },
  refreshToken: async () => {
    throw new Error("not used here");
  },
};

beforeAll(async () => {
  h = await startHarness();
  const sessions = new SessionService(h.app, () => new Date());
  const registry = new NotificationTypeRegistry();
  registry.register({ type: "security_transactional", channel: "email", dailyBudget: 0, cooldownSeconds: 0, budgetExempt: true });
  const delivery = new Delivery({ registry, channels: [{ channel: "email", send: async () => {} }], ledger: async () => {}, clock: () => new Date() });
  vault = new TokenVault(h.vault, { encryptionKeyHex: "b".repeat(64), keyId: "k1" }, () => new Date());
  server = createApiServer({
    pool: h.app,
    magic: new MagicLinkService(h.app, delivery, () => new Date(), { baseUrl: "https://x" }),
    sessions,
    googleOAuth: {
      clientId: "client-123",
      redirectUri: "https://app.test/connections/google/callback",
      stateHmacKey: "hmac-key",
      endpoint,
      vault,
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "string" || !addr) throw new Error("no addr");
  base = `http://127.0.0.1:${addr.port}`;

  const me = await provisionOnSignIn(h.app, "halim@test.dev");
  const other = await provisionOnSignIn(h.app, "other@test.dev");
  myWorkspaceId = me.workspaces[0]!.id;
  sid = (await sessions.issue(me.userId, "node-other", "127.0.0.1")).sessionId;
  sidOther = (await sessions.issue(other.userId, "node-other", "127.0.0.1")).sessionId;
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await h.stop();
});

const get = (path: string, cookie = "") =>
  fetch(`${base}${path}`, { headers: { "user-agent": "node", ...(cookie ? { cookie } : {}) }, redirect: "manual" });

describe("GET /connections/google/authorize", () => {
  it("401 unauthenticated; 403 for non-members; consent URL for a member", async () => {
    expect((await get(`/connections/google/authorize?workspaceId=${myWorkspaceId}`)).status).toBe(401);
    expect((await get(`/connections/google/authorize?workspaceId=${myWorkspaceId}`, `sid=${sidOther}`)).status).toBe(403);
    const res = await get(`/connections/google/authorize?workspaceId=${myWorkspaceId}`, `sid=${sid}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    const url = new URL(body.url);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("state")).toBeTruthy();
  });
});

describe("GET /connections/google/callback", () => {
  let state = "";

  it("creates the workspace-owned connection, stores tokens in the vault only, audits, leaks nothing", async () => {
    const authorize = await get(`/connections/google/authorize?workspaceId=${myWorkspaceId}`, `sid=${sid}`);
    state = new URL(((await authorize.json()) as { url: string }).url).searchParams.get("state")!;

    const res = await get(`/connections/google/callback?code=good-code&state=${encodeURIComponent(state)}`, `sid=${sid}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("SECRET"); // I8: nothing token-shaped in the response
    const body = JSON.parse(text) as { connection: { id: string; provider: string; status: string } };
    expect(body.connection.provider).toBe("gsc");
    expect(body.connection.status).toBe("active");
    expect(Object.keys(body.connection).sort()).toEqual(["id", "provider", "status"]);

    const conn = await h.admin.query(
      `SELECT authorized_by, capabilities, scopes FROM connections WHERE id = $1`, [body.connection.id],
    );
    expect(conn.rows[0].capabilities).toMatchObject({ read_search_analytics: true, publish: false });
    expect(conn.rows[0].scopes).toContain("https://www.googleapis.com/auth/webmasters.readonly");

    const tokens = await vault.getTokens(myWorkspaceId, body.connection.id);
    expect(tokens?.accessToken).toBe("ya29.SECRET-ACCESS");
    const audit = await h.admin.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE event = 'provider.connected' AND workspace_id = $1`, [myWorkspaceId],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it("replayed/foreign/expired state → generic 400; provider auth failure → generic 401", async () => {
    const replay = await get(`/connections/google/callback?code=good-code&state=${encodeURIComponent(state)}`, `sid=${sidOther}`);
    expect(replay.status).toBe(400); // state bound to another user

    const bad = await get(`/connections/google/callback?code=good-code&state=tampered`, `sid=${sid}`);
    expect(bad.status).toBe(400);

    const authorize = await get(`/connections/google/authorize?workspaceId=${myWorkspaceId}`, `sid=${sid}`);
    const fresh = new URL(((await authorize.json()) as { url: string }).url).searchParams.get("state")!;
    const denied = await get(`/connections/google/callback?code=bad-code&state=${encodeURIComponent(fresh)}`, `sid=${sid}`);
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "provider_auth_failed" });
  });
});
