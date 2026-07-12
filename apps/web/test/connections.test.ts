/** STEP 6.5 — connections page: GSC state/health/site/scopes/last sync/reconnect from repositories. */
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Delivery, NotificationTypeRegistry } from "@aigos/delivery";
import { MagicLinkService, SessionService } from "@aigos/identity";
import { ConnectionRepository, provisionOnSignIn, updateConnectionHealth, updateSyncState, withWorkspace } from "@aigos/database";

import { createWebServer } from "../src/server.js";
import { startHarness, type Harness } from "../../../packages/database/test/harness.js";

let h: Harness; let server: Server; let base: string; let sid = "";

beforeAll(async () => {
  h = await startHarness();
  const sessions = new SessionService(h.app, () => new Date());
  const registry = new NotificationTypeRegistry();
  registry.register({ type: "security_transactional", channel: "email", dailyBudget: 0, cooldownSeconds: 0, budgetExempt: true });
  const delivery = new Delivery({ registry, channels: [{ channel: "email", send: async () => {} }], ledger: async () => {}, clock: () => new Date() });
  server = createWebServer({ pool: h.app, magic: new MagicLinkService(h.app, delivery, () => new Date(), { baseUrl: "https://x" }), sessions, clock: () => new Date("2026-07-12T09:00:00Z") });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address(); if (typeof addr === "string" || !addr) throw new Error("no addr");
  base = `http://127.0.0.1:${addr.port}`;
  const me = await provisionOnSignIn(h.app, "halim@test.dev");
  const ws = me.workspaces[0]!.id;
  sid = (await sessions.issue(me.userId, "node-other", "127.0.0.1")).sessionId;
  const cid = await withWorkspace(h.app, ws, (tx) => new ConnectionRepository().create(tx, { provider: "gsc", scopes: ["https://www.googleapis.com/auth/webmasters.readonly"], capabilities: {}, authorizedBy: me.userId }));
  await withWorkspace(h.app, ws, (tx) => new ConnectionRepository().setSite(tx, cid, "sc-domain:forgcv.com"));
  await updateSyncState(h.app, ws, cid, { lastSuccessfulSync: new Date("2026-07-10T00:00:00Z"), addImportedRows: 42, addApiQuotaUsed: 3 });
  await updateConnectionHealth(h.app, ws, cid, "healthy", "sync ok");
}, 120_000);

afterAll(async () => { await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))); await h.stop(); });

describe("connections page", () => {
  it("shows GSC status, health, site, permissions, last sync and no reconnect when healthy", async () => {
    const html = await (await fetch(`${base}/connections`, { headers: { "user-agent": "node", cookie: `sid=${sid}` }, redirect: "manual" })).text();
    expect(html).toContain("Google Search Console");
    expect(html).toContain("health healthy");
    expect(html).toContain("sc-domain:forgcv.com");
    expect(html).toContain("webmasters.readonly");
    expect(html).toContain("2026-07-10");
    expect(html).toContain("ingested rows: 42");
    expect(html).toContain("refresh token: valid");
    expect(html).not.toContain(">Reconnect<");
  });
});
