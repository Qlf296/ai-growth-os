/** STEP 6.8 — AI usage dashboard from llm_calls (reuse CostMeter persistence). */
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Delivery, NotificationTypeRegistry } from "@aigos/delivery";
import { MagicLinkService, SessionService } from "@aigos/identity";
import { provisionOnSignIn, withWorkspace } from "@aigos/database";
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
  await withWorkspace(h.app, ws, (tx) => tx.query(`INSERT INTO llm_calls (workspace_id, feature, tier, provider, input_tokens, output_tokens, cost_eur, latency_ms, cached) VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'draft.seo_title', 't3', 'fake', 12, 20, 0.003, 40, false)`));
}, 120_000);
afterAll(async () => { await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))); await h.stop(); });

describe("usage dashboard", () => {
  it("shows requests, tokens, cost, cache, provider, monthly and history from the ledger", async () => {
    const html = await (await fetch(`${base}/usage`, { headers: { "user-agent": "node", cookie: `sid=${sid}` }, redirect: "manual" })).text();
    expect(html).toContain("1 requests");
    expect(html).toContain("12+20 tokens");
    expect(html).toContain("€0.0030");
    expect(html).toContain("fake");
    expect(html).toContain("draft.seo_title");
    expect(html).toContain("avg latency 40ms");
  });
});
