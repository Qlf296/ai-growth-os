/**
 * Phase 7.7 — full loop end-to-end:
 * Signal → Detection → Growth → Recommendation → Draft → Automation → Experiment → Evaluation.
 * Real Postgres, fixtures only. Every step reuses existing engines; no publishing (Law 5).
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { InMemoryBudgetGuard, PromptTemplateRegistry, type ModelProvider } from "@aigos/ai-gateway";
import { assignVariant, buildDefaultActionRegistry, createExperiment, emitOpportunityEvent, evaluateExperiment, recordMetric } from "@aigos/automation";
import { ConfigRegistry, InMemoryConfigStore } from "@aigos/config-registry";
import { ConnectionRepository, SignalRepository, withWorkspace } from "@aigos/database";
import { generateDraft, registerDraftTemplates } from "@aigos/action";
import { buildGrowth, registerGrowthWeights } from "@aigos/growth";
import { runDetection } from "@aigos/intelligence";
import { FsRawStore, InMemoryCache } from "@aigos/infra";

import { startHarness, seedWorkspace, type Harness } from "../../../packages/database/test/harness.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let h: Harness;
const WS = randomUUID();
const USER = randomUUID();
let connectionId = "";
const DAY = "2026-06-15";
void FsRawStore; void mkdtempSync; void tmpdir; void join;

const provider: ModelProvider = { name: "fake", async invoke(p) { return { text: `DRAFT ${p.slice(0, 8)}`, inputTokens: 8, outputTokens: 12, costEur: 0.002 }; } };

async function seedSignal(page: string, date: string, o: { clicks: number; impressions: number; position: number }): Promise<void> {
  const externalId = `${date}|q|${page}`;
  await withWorkspace(h.app, WS, (tx) => new SignalRepository().insertMany(tx, [{
    connectionId, source: "gsc", type: "gsc.search_analytics.daily", externalId,
    occurredAt: new Date(`${date}T00:00:00Z`), payloadRef: `${WS}/gsc/${date}/x`,
    data: { page, query: "q", clicks: o.clicks, impressions: o.impressions, ctr: o.impressions ? o.clicks / o.impressions : 0, position: o.position },
    normalizerVersion: 1, dedupeHash: createHash("sha256").update(`gsc|daily|${externalId}`).digest("hex"),
  }]));
}

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  await h.admin.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@t.dev', 'magic_link')`, [USER]);
  connectionId = await withWorkspace(h.app, WS, (tx) => new ConnectionRepository().create(tx, { provider: "gsc", scopes: [], capabilities: {}, authorizedBy: USER }));
  // striking-distance page over the recent window
  for (const d of ["2026-06-09", "2026-06-11", "2026-06-13"]) await seedSignal("https://forgcv.com/cv", d, { clicks: 5, impressions: 400, position: 14 });
}, 120_000);

afterAll(async () => { await h.stop(); });

describe("full loop: signal → detection → growth → recommendation → draft → automation → experiment → evaluation", () => {
  it("runs the whole chain and ends with an evaluated experiment; opportunity accepted via human-configured automation", async () => {
    // 1) Detection
    const det = await runDetection({ pool: h.app, workspaceId: WS, now: new Date(`${DAY}T00:00:00Z`), windowDays: 7 });
    expect(det.findings).toBeGreaterThan(0);

    // 2) Growth → opportunities + recommendations
    const config = new ConfigRegistry(new InMemoryConfigStore());
    registerGrowthWeights(config);
    const growth = await buildGrowth({ pool: h.app, config, workspaceId: WS, day: DAY });
    expect(growth.opportunities).toBeGreaterThan(0);
    const opp = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT o.id AS oid, r.id AS rid FROM opportunities o JOIN recommendations r ON r.opportunity_id = o.id LIMIT 1`));
    const opportunityId = opp.rows[0].oid as string;
    const recommendationId = opp.rows[0].rid as string;

    // 3) Draft (via AI Gateway)
    const templates = new PromptTemplateRegistry(); registerDraftTemplates(templates);
    const draft = await generateDraft({ pool: h.app, provider, templates, cache: new InMemoryCache(), budget: new InMemoryBudgetGuard(5) }, WS, recommendationId, "seo_title");
    expect(draft.content).toContain("DRAFT");

    // 4) Automation: human-configured rules auto-validate then auto-accept (Law 16; no publishing)
    const registry = buildDefaultActionRegistry(h.app);
    await withWorkspace(h.app, WS, async (tx) => {
      await tx.query(`INSERT INTO automation_rules (workspace_id, name, trigger, condition, action, ladder_level, created_by) VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'validate', '{"type":"opportunity.detected"}'::jsonb, '[]'::jsonb, 'opportunity.validate', 'A2', $1)`, [USER]);
      await tx.query(`INSERT INTO automation_rules (workspace_id, name, trigger, condition, action, ladder_level, created_by) VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'accept', '{"type":"opportunity.validated"}'::jsonb, '[]'::jsonb, 'opportunity.accept', 'A2', $1)`, [USER]);
    });
    await emitOpportunityEvent(h.app, registry, WS, opportunityId, "opportunity.detected");
    await emitOpportunityEvent(h.app, registry, WS, opportunityId, "opportunity.validated");
    const st = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT status FROM opportunities WHERE id = $1`, [opportunityId]));
    expect(st.rows[0].status).toBe("accepted");

    // 5) Experiment from the accepted recommendation
    const exp = await createExperiment(h.app, WS, { recommendationId, hypothesis: "New title lifts CTR", expectedImpact: "+10%", confidence: "high", metric: "ctr", variants: [{ label: "control" }, { label: "treatment" }] });
    const variant = await assignVariant(h.app, WS, exp.id, "https://forgcv.com/cv");
    expect(variant).toBeTruthy();
    const treatment = exp.variants.find((v) => v.label === "treatment")!;
    await recordMetric(h.app, WS, exp.id, treatment.id, "ctr", 0.06);

    // 6) Evaluation → winner
    const result = await evaluateExperiment(h.app, WS, exp.id);
    expect(result.winnerLabel).toBe("treatment");
    expect(result.outcome).toBe("promotion");

    // Invariants across the loop: audit trail + no publishing anywhere
    const audits = await h.admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE workspace_id = $1 AND event IN ('opportunity.transition','experiment.evaluated')`, [WS]);
    expect(audits.rows[0].n).toBeGreaterThanOrEqual(3);
    const published = await h.admin.query(`SELECT count(*)::int AS n FROM drafts WHERE status = 'published'`);
    expect(published.rows[0].n).toBe(0); // Law 5 — nothing auto-published
  });
});
