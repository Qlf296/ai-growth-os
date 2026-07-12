/** STEP 5.1/5.3/5.4/5.5/5.6 — draft generation, cost ledger, approval, digest on real Postgres. */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { InMemoryBudgetGuard, PromptTemplateRegistry, type ModelProvider } from "@aigos/ai-gateway";
import { withWorkspace } from "@aigos/database";
import { InMemoryCache } from "@aigos/infra";

import { DRAFT_TYPES, buildDigest, generateDraft, registerDraftTemplates, transitionDraft, type DraftEngineDeps } from "../src/index.js";
import { startHarness, seedWorkspace, type Harness } from "../../database/test/harness.js";

let h: Harness;
const WS = randomUUID();
const OTHER = randomUUID();
const USER = randomUUID();
let recommendationId = "";
let opportunityId = "";
let evidenceId = "";
const DAY = "2026-06-15";

function fakeProvider(): ModelProvider & { calls: number } {
  const p = {
    name: "fake",
    calls: 0,
    async invoke(prompt: string) {
      p.calls++;
      return { text: `DRAFT<<${prompt.slice(0, 24)}>>`, inputTokens: 12, outputTokens: 20, costEur: 0.002 };
    },
  };
  return p;
}

const makeDeps = (provider: ModelProvider, budgetEur = 5): DraftEngineDeps => {
  const templates = new PromptTemplateRegistry();
  registerDraftTemplates(templates);
  return { pool: h.app, provider, templates, cache: new InMemoryCache(), budget: new InMemoryBudgetGuard(budgetEur) };
};

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  await seedWorkspace(h.admin, OTHER, "other");
  await h.admin.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@t.dev', 'magic_link')`, [USER]);
  evidenceId = randomUUID();
  await withWorkspace(h.app, WS, async (tx) => {
    await tx.query(`INSERT INTO evidence (id, workspace_id, generated_by, data) VALUES ($1, NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'x@1', '{}'::jsonb)`, [evidenceId]);
    const o = await tx.query(
      `INSERT INTO opportunities (workspace_id, entity, category, detectors, severity, confidence, impact, difficulty, effort, roi, priority_score, score_trace, evidence_ids, occurred_on, dedupe_hash)
       VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'https://forgcv.com/cv', 'seo', '["seo.ctr_gap"]'::jsonb, 'low', 'medium', 'medium', 'low', 'low', '{}'::jsonb, 0.5, '{}'::jsonb, $1::jsonb, $2, $3) RETURNING id`,
      [JSON.stringify([evidenceId]), DAY, randomUUID()],
    );
    opportunityId = o.rows[0].id;
    const r = await tx.query(
      `INSERT INTO recommendations (workspace_id, opportunity_id, title, summary, business_reason, technical_reason, expected_impact, evidence_ids, affected_entities, prerequisites, steps, rollback)
       VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, 'T', 'improve CTR', 'biz', 'tech', 'impact clicks', $2::jsonb, '["https://forgcv.com/cv"]'::jsonb, '["healthy connection"]'::jsonb, '["step 1","step 2"]'::jsonb, 'revert') RETURNING id`,
      [opportunityId, JSON.stringify([evidenceId])],
    );
    recommendationId = r.rows[0].id;
  });
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe("draft generation via the AI Gateway (I6/AT-6)", () => {
  it("generates all 8 draft types with full metadata, evidence ref and a persisted usage ledger", async () => {
    const provider = fakeProvider();
    const deps = makeDeps(provider);
    for (const type of DRAFT_TYPES) {
      const draft = await generateDraft(deps, WS, recommendationId, type);
      expect(draft.content).toContain("DRAFT<<");
      expect(draft.promptTemplateVersion).toBe(1);
      expect(draft.provider).toBe("fake");
    }
    const rows = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT draft_type, prompt_template_id, prompt_template_version, provider, tier, trace_id, evidence_ids, cost_eur, status FROM drafts ORDER BY draft_type`));
    expect(rows.rowCount).toBe(8);
    for (const r of rows.rows as Array<Record<string, unknown>>) {
      expect(r.prompt_template_id).toBe(`draft.${r.draft_type}`);
      expect(r.prompt_template_version).toBe(1);
      expect(r.tier).toBe("t3");
      expect((r.evidence_ids as unknown[])[0]).toBe(evidenceId); // I4
      expect(Number(r.cost_eur)).toBeGreaterThan(0);
      expect(r.status).toBe("draft");
    }
    const ledger = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n, sum(cost_eur)::float AS c FROM llm_calls`));
    expect(ledger.rows[0].n).toBe(8);
    expect(ledger.rows[0].c).toBeCloseTo(8 * 0.002);
  });

  it("response cache: regenerating the same draft type reuses the model call (cost 0, cached)", async () => {
    const provider = fakeProvider();
    const deps = makeDeps(provider);
    await generateDraft(deps, WS, recommendationId, "social_post");
    const second = await generateDraft(deps, WS, recommendationId, "social_post");
    expect(provider.calls).toBe(1);
    expect(second.cached).toBe(true);
    expect(second.costEur).toBe(0);
  });

  it("budget gate: an exhausted budget refuses generation (no draft, no ledger row beyond the first)", async () => {
    const provider = fakeProvider();
    const deps = makeDeps(provider, 0.001); // below one call's cost
    const before = (await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n FROM drafts`))).rows[0].n;
    await generateDraft(deps, WS, recommendationId, "technical_fix_summary"); // first call allowed (spends the budget)
    await expect(generateDraft(deps, WS, recommendationId, "technical_fix_summary")).rejects.toThrow(/budget/i); // same feature → over budget
    const after = (await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n FROM drafts`))).rows[0].n;
    expect(after).toBe(before + 1); // only the allowed one persisted
  });

  it("RLS: another workspace sees no drafts or usage", async () => {
    expect((await withWorkspace(h.app, OTHER, (tx) => tx.query(`SELECT * FROM drafts`))).rowCount).toBe(0);
    expect((await withWorkspace(h.app, OTHER, (tx) => tx.query(`SELECT * FROM llm_calls`))).rowCount).toBe(0);
  });
});

describe("human approval workflow (no auto-publish, Law 5)", () => {
  it("audits every transition and forbids illegal jumps", async () => {
    const provider = fakeProvider();
    const draft = await generateDraft(makeDeps(provider), WS, recommendationId, "meta_description");
    await transitionDraft(h.app, WS, draft.id, "reviewed", "halim", "looks good");
    await transitionDraft(h.app, WS, draft.id, "approved", "halim", "ship it");
    await transitionDraft(h.app, WS, draft.id, "published", "halim", "posted manually");
    await expect(transitionDraft(h.app, WS, draft.id, "reviewed", "halim", "back")).rejects.toThrow(/illegal/);
    const audit = await h.admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE event = 'draft.transition' AND details->>'draftId' = $1`, [draft.id]);
    expect(audit.rows[0].n).toBe(3);
  });
});

describe("daily AI digest", () => {
  it("assembles feed + recommendations + drafts + pending approvals + completed", async () => {
    const digest = await buildDigest(h.app, WS, DAY);
    expect(digest.opportunities).toBeGreaterThan(0);
    expect(digest.recommendations).toBeGreaterThan(0);
    expect(digest.drafts.length).toBeGreaterThan(0);
    expect(digest.pendingApprovals.every((d) => d.status === "draft" || d.status === "reviewed")).toBe(true);
    expect(digest.feed.total).toBeGreaterThan(0);
    // replay: deterministic
    const again = await buildDigest(h.app, WS, DAY);
    expect(again.feed.items.map((i) => i.opportunityId)).toEqual(digest.feed.items.map((i) => i.opportunityId));
  });
});
