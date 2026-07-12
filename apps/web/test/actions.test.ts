/** STEP 6.3 — Action Center: lists drafts with model/tokens/cost/evidence and reuses transitionDraft. */
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { InMemoryBudgetGuard, PromptTemplateRegistry, type ModelProvider } from "@aigos/ai-gateway";
import { Delivery, NotificationTypeRegistry } from "@aigos/delivery";
import { MagicLinkService, SessionService } from "@aigos/identity";
import { provisionOnSignIn, withWorkspace } from "@aigos/database";
import { generateDraft, registerDraftTemplates } from "@aigos/action";
import { InMemoryCache } from "@aigos/infra";

import { createWebServer } from "../src/server.js";
import { startHarness, type Harness } from "../../../packages/database/test/harness.js";

let h: Harness;
let server: Server;
let base: string;
let sid = "";
let ws = "";
let draftId = "";

const provider: ModelProvider = { name: "fake", async invoke(p) { return { text: `DRAFT ${p.slice(0, 8)}`, inputTokens: 10, outputTokens: 15, costEur: 0.003 }; } };

beforeAll(async () => {
  h = await startHarness();
  const sessions = new SessionService(h.app, () => new Date());
  const registry = new NotificationTypeRegistry();
  registry.register({ type: "security_transactional", channel: "email", dailyBudget: 0, cooldownSeconds: 0, budgetExempt: true });
  const delivery = new Delivery({ registry, channels: [{ channel: "email", send: async () => {} }], ledger: async () => {}, clock: () => new Date() });
  server = createWebServer({ pool: h.app, magic: new MagicLinkService(h.app, delivery, () => new Date(), { baseUrl: "https://x" }), sessions, clock: () => new Date("2026-07-12T09:00:00Z") });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr === "string" || !addr) throw new Error("no addr");
  base = `http://127.0.0.1:${addr.port}`;

  const me = await provisionOnSignIn(h.app, "halim@test.dev");
  ws = me.workspaces[0]!.id;
  sid = (await sessions.issue(me.userId, "node-other", "127.0.0.1")).sessionId;
  const evidenceId = randomUUID();
  let recommendationId = "";
  await withWorkspace(h.app, ws, async (tx) => {
    await tx.query(`INSERT INTO evidence (id, workspace_id, generated_by, data) VALUES ($1, NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'x@1', '{}'::jsonb)`, [evidenceId]);
    const o = await tx.query(`INSERT INTO opportunities (workspace_id, entity, category, detectors, severity, confidence, impact, difficulty, effort, roi, priority_score, score_trace, evidence_ids, occurred_on, dedupe_hash) VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'https://forgcv.com/cv', 'seo', '[]'::jsonb, 'low', 'medium', 'medium', 'low', 'low', '{}'::jsonb, 0.5, '{}'::jsonb, $1::jsonb, '2026-07-12', $2) RETURNING id`, [JSON.stringify([evidenceId]), randomUUID()]);
    const r = await tx.query(`INSERT INTO recommendations (workspace_id, opportunity_id, title, summary, business_reason, technical_reason, expected_impact, evidence_ids, affected_entities, prerequisites, steps, rollback) VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, 'Close CTR gap', 's', 'b', 't', 'clicks', $2::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'r') RETURNING id`, [o.rows[0].id, JSON.stringify([evidenceId])]);
    recommendationId = r.rows[0].id;
  });
  const templates = new PromptTemplateRegistry();
  registerDraftTemplates(templates);
  const draft = await generateDraft({ pool: h.app, provider, templates, cache: new InMemoryCache(), budget: new InMemoryBudgetGuard(5) }, ws, recommendationId, "seo_title");
  draftId = draft.id;
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await h.stop();
});

const req = (path: string, method = "GET", body?: unknown) =>
  fetch(`${base}${path}`, { method, headers: { "user-agent": "node", cookie: `sid=${sid}`, "content-type": "application/json", "x-csrf": "1" }, body: body ? JSON.stringify(body) : null, redirect: "manual" });

describe("Action Center", () => {
  it("lists the draft with recommendation, model, tokens, cost and evidence", async () => {
    const html = await (await req("/actions")).text();
    expect(html).toContain("seo_title");
    expect(html).toContain("Close CTR gap");
    expect(html).toContain("fake/t3");
    expect(html).toContain("tokens 10+15");
    expect(html).toContain("evidence 1");
    expect(html).toContain("Approve");
  });

  it("reuses transitionDraft (draft → reviewed) and audits it; illegal jump → 409", async () => {
    expect((await req("/drafts/transition", "POST", { workspaceId: ws, draftId, to: "reviewed" })).status).toBe(200);
    const s = await h.admin.query(`SELECT status FROM drafts WHERE id = $1`, [draftId]);
    expect(s.rows[0].status).toBe("reviewed");
    const bad = await req("/drafts/transition", "POST", { workspaceId: ws, draftId, to: "published" });
    expect(bad.status).toBe(409);
    const audit = await h.admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE event = 'draft.transition' AND details->>'draftId' = $1`, [draftId]);
    expect(audit.rows[0].n).toBe(1);
  });

  it("archive maps to reject (no new lifecycle state)", async () => {
    expect((await req("/drafts/transition", "POST", { workspaceId: ws, draftId, to: "archived" })).status).toBe(200);
    const s = await h.admin.query(`SELECT status FROM drafts WHERE id = $1`, [draftId]);
    expect(s.rows[0].status).toBe("rejected");
  });
});
