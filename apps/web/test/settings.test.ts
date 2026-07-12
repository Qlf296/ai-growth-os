/**
 * Phase 1.6 — Settings (S6 §2: device list visible, per-device sign-out).
 * Reuses SessionService/identity/workspace services — no duplicated logic.
 */
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Delivery, NotificationTypeRegistry } from "@aigos/delivery";
import { MagicLinkService, SessionService } from "@aigos/identity";
import { provisionOnSignIn } from "@aigos/database";

import { createWebServer } from "../src/server.js";
import { startHarness, type Harness } from "../../../packages/database/test/harness.js";

let h: Harness;
let server: Server;
let base: string;
let sessions: SessionService;
let userId = "";
let otherUserId = "";
let myWorkspaceId = "";
let sidCurrent = "";
let sidPhone = "";
let sidOtherUser = "";

beforeAll(async () => {
  h = await startHarness();
  sessions = new SessionService(h.app, () => new Date());
  const registry = new NotificationTypeRegistry();
  registry.register({ type: "security_transactional", channel: "email", dailyBudget: 0, cooldownSeconds: 0, budgetExempt: true });
  const delivery = new Delivery({ registry, channels: [{ channel: "email", send: async () => {} }], ledger: async () => {}, clock: () => new Date() });
  server = createWebServer({
    pool: h.app,
    magic: new MagicLinkService(h.app, delivery, () => new Date(), { baseUrl: "https://x" }),
    sessions,
    clock: () => new Date("2026-07-12T09:00:00Z"),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "string" || !addr) throw new Error("no addr");
  base = `http://127.0.0.1:${addr.port}`;

  const me = await provisionOnSignIn(h.app, "halim@test.dev");
  const other = await provisionOnSignIn(h.app, "other@test.dev");
  userId = me.userId;
  myWorkspaceId = me.workspaces[0]!.id;
  otherUserId = other.userId;
  sidCurrent = (await sessions.issue(userId, "node-other", "127.0.0.1")).sessionId;
  sidPhone = (await sessions.issue(userId, "safari-ios", "10.0.0.9")).sessionId;
  sidOtherUser = (await sessions.issue(otherUserId, "chrome-windows", "10.0.0.8")).sessionId;
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await h.stop();
});

const get = (path: string, sid: string) =>
  fetch(`${base}${path}`, { headers: { "user-agent": "node", cookie: `sid=${sid}` }, redirect: "manual" });

const post = (path: string, sid: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf": "1", "user-agent": "node", cookie: `sid=${sid}` },
    body: body === undefined ? null : JSON.stringify(body),
  });

describe("GET /me/sessions", () => {
  it("lists only my active devices, current one flagged", async () => {
    const res = await get("/me/sessions", sidCurrent);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: { id: string; uaFamily: string; current: boolean }[] };
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.find((s) => s.id === sidCurrent)?.current).toBe(true);
    expect(body.sessions.find((s) => s.id === sidPhone)?.current).toBe(false);
    expect(body.sessions.some((s) => s.id === sidOtherUser)).toBe(false);
  });
});

describe("settings page (SSR)", () => {
  it("renders profile, workspace, plan and the device list with actions", async () => {
    const res = await get("/settings", sidCurrent);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("halim@test.dev");           // profile
    expect(html).toContain("halim&#39;s workspace");     // workspace
    expect(html).toContain("free");                      // plan
    expect(html).toContain("safari-ios");                // device list
    expect(html).toContain("This device");
    expect(html).toContain("Sign out all other devices");
  });

  it("renders a Connections section: Connect button when GSC is not connected", async () => {
    const html = await (await get("/settings", sidCurrent)).text();
    expect(html).toContain("Connections");
    expect(html).toContain("Connect Google Search Console");
    expect(html).toContain("/connections/google/authorize");
  });

  it("shows GSC as connected once a connection exists", async () => {
    const { withWorkspace, ConnectionRepository } = await import("@aigos/database");
    await withWorkspace(h.app, myWorkspaceId, (tx) =>
      new ConnectionRepository().create(tx, {
        provider: "gsc", scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
        capabilities: { read_search_analytics: true }, authorizedBy: userId,
      }),
    );
    const html = await (await get("/settings", sidCurrent)).text();
    expect(html).toContain("Google Search Console");
    expect(html).toContain("active");
    expect(html).toContain("Sign out");
  });
});

describe("device sign-out", () => {
  it("revoking my phone kills it; revoking someone else's session is a generic 404", async () => {
    const foreign = await post("/me/sessions/revoke", sidCurrent, { sessionId: sidOtherUser });
    expect(foreign.status).toBe(404);
    expect(await sessions.validate(sidOtherUser)).not.toBeNull();

    const res = await post("/me/sessions/revoke", sidCurrent, { sessionId: sidPhone });
    expect(res.status).toBe(204);
    expect(await sessions.validate(sidPhone)).toBeNull();
    const audited = await h.admin.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE event = 'session.revoked'",
    );
    expect(audited.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("sign out all other devices keeps only the current session", async () => {
    const extra = await sessions.issue(userId, "firefox-linux", "10.0.0.7");
    const res = await post("/me/sessions/revoke-others", sidCurrent);
    expect(res.status).toBe(204);
    expect(await sessions.validate(extra.sessionId)).toBeNull();
    expect(await sessions.validate(sidCurrent)).not.toBeNull();
    expect(await sessions.validate(sidOtherUser)).not.toBeNull(); // other users untouched
  });

  it("CSRF required on both new POST routes", async () => {
    for (const path of ["/me/sessions/revoke", "/me/sessions/revoke-others"]) {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "user-agent": "node", cookie: `sid=${sidCurrent}` },
      });
      expect(res.status, path).toBe(403);
    }
  });

  it("sign out current session works through the existing /auth/logout (reuse, no duplication)", async () => {
    const s = await sessions.issue(userId, "node-other", "127.0.0.1");
    const res = await post("/auth/logout", s.sessionId);
    expect(res.status).toBe(204);
    expect(await sessions.validate(s.sessionId)).toBeNull();
  });
});
