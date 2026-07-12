/** STEP 6.4 — experiments page: read-only, grouped by state, honest empty (no fake data). */
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Delivery, NotificationTypeRegistry } from "@aigos/delivery";
import { MagicLinkService, SessionService } from "@aigos/identity";
import { provisionOnSignIn } from "@aigos/database";

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
  sid = (await sessions.issue(me.userId, "node-other", "127.0.0.1")).sessionId;
}, 120_000);

afterAll(async () => { await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))); await h.stop(); });

describe("experiments page", () => {
  it("renders Running/Completed/Archived groups with honest empty state", async () => {
    const html = await (await fetch(`${base}/experiments`, { headers: { "user-agent": "node", cookie: `sid=${sid}` }, redirect: "manual" })).text();
    expect(html).toContain("Running");
    expect(html).toContain("Completed");
    expect(html).toContain("Archived");
    expect(html).toContain("No experiments yet");
    expect(html).not.toMatch(/lorem|placeholder|coming soon/i);
  });
});
