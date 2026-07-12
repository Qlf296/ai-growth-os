/** STEP 6.9 — perf hygiene: per-user pages carry Cache-Control private,no-store; Action Center paginates. */
import { randomUUID } from "node:crypto";
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
  // seed 7 drafts (pageSize 5 → 2 pages)
  await withWorkspace(h.app, ws, async (tx) => {
    const ev = randomUUID();
    await tx.query(`INSERT INTO evidence (id, workspace_id, generated_by, data) VALUES ($1, NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'x@1', '{}'::jsonb)`, [ev]);
    const o = await tx.query(`INSERT INTO opportunities (workspace_id, entity, category, detectors, severity, confidence, impact, difficulty, effort, roi, priority_score, score_trace, evidence_ids, occurred_on, dedupe_hash) VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'e', 'seo', '[]'::jsonb, 'low', 'medium', 'medium', 'low', 'low', '{}'::jsonb, 0.5, '{}'::jsonb, $1::jsonb, '2026-07-12', $2) RETURNING id`, [JSON.stringify([ev]), randomUUID()]);
    const r = await tx.query(`INSERT INTO recommendations (workspace_id, opportunity_id, title, summary, business_reason, technical_reason, expected_impact, evidence_ids, affected_entities, prerequisites, steps, rollback) VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, 'T', 's', 'b', 't', 'i', $2::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'r') RETURNING id`, [o.rows[0].id, JSON.stringify([ev])]);
    for (let i = 0; i < 7; i++) {
      await tx.query(`INSERT INTO drafts (workspace_id, recommendation_id, draft_type, content, prompt_template_id, prompt_template_version, provider, tier, cached, trace_id, evidence_ids) VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, 'seo_title', 'c', 'draft.seo_title', 1, 'fake', 't3', false, $2, $3::jsonb)`, [r.rows[0].id, randomUUID(), JSON.stringify([ev])]);
    }
  });
}, 120_000);
afterAll(async () => { await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))); await h.stop(); });

const get = (path: string) => fetch(`${base}${path}`, { headers: { "user-agent": "node", cookie: `sid=${sid}` }, redirect: "manual" });

describe("performance hygiene", () => {
  it("authenticated pages set Cache-Control private, no-store", async () => {
    const res = await get("/");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
  it("Action Center paginates (5 per page, 2 pages)", async () => {
    const p1 = await (await get("/actions?page=1")).text();
    expect(p1).toContain("page 1/2");
    expect(p1).toContain("next →");
    const p2 = await (await get("/actions?page=2")).text();
    expect(p2).toContain("page 2/2");
    expect(p2).toContain("← prev");
  });
});
