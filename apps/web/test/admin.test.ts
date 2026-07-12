/** STEP 6.7 — workspace administration: workspace/members/roles/plan/limits/usage from repositories. */
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
  await withWorkspace(h.app, ws, (tx) => tx.query(`INSERT INTO llm_calls (workspace_id, feature, tier, provider, input_tokens, output_tokens, cost_eur) VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'draft.seo_title', 't3', 'fake', 10, 20, 0.005)`));
}, 120_000);
afterAll(async () => { await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))); await h.stop(); });

describe("admin page", () => {
  it("shows workspace, member+role, plan+limits and AI usage", async () => {
    const html = await (await fetch(`${base}/admin`, { headers: { "user-agent": "node", cookie: `sid=${sid}` }, redirect: "manual" })).text();
    expect(html).toContain("halim@test.dev");   // member
    expect(html).toContain("owner");            // role
    expect(html).toContain("plan free");
    expect(html).toContain("daily_actions");    // limits
    expect(html).toContain("1 AI requests");
    expect(html).toContain("10+20 tokens");
  });
});
