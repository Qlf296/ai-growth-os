/**
 * Phase 9.7 — the complete closed loop:
 * GSC signals → detection → opportunity → recommendation → human acceptance →
 * automation → completion → baseline → measurement (attribution) → grade →
 * learning propagation → knowledge promotion → improved (arbitrated) recommendation.
 * Every step produces evidence (I4). Real Postgres, fixtures only, no publishing (Law 5).
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildDefaultActionRegistry, emitOpportunityEvent } from "@aigos/automation";
import {
  evaluatePromotion, promoteKnowledge, propagateLearning, recordOutcome, resolveAttribution,
} from "@aigos/analytics";
import { ConfigRegistry, InMemoryConfigStore } from "@aigos/config-registry";
import { ConnectionRepository, SignalRepository, snapshotBaseline, withWorkspace } from "@aigos/database";
import { arbitrateV2, buildGrowth, registerGrowthWeights, shadowEvaluateArbitration, transitionOpportunity } from "@aigos/growth";
import { runDetection } from "@aigos/intelligence";

import { startHarness, seedWorkspace, type Harness } from "../../../packages/database/test/harness.js";

let h: Harness;
const WS = randomUUID();
const USER = randomUUID();
let connectionId = "";
const DAY = "2026-06-15";

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  await h.admin.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@t.dev', 'magic_link')`, [USER]);
  connectionId = await withWorkspace(h.app, WS, (tx) => new ConnectionRepository().create(tx, { provider: "gsc", scopes: [], capabilities: {}, authorizedBy: USER }));
  for (const d of ["2026-06-09", "2026-06-11", "2026-06-13"]) {
    const externalId = `${d}|q|https://forgcv.com/cv`;
    await withWorkspace(h.app, WS, (tx) => new SignalRepository().insertMany(tx, [{
      connectionId, source: "gsc", type: "gsc.search_analytics.daily", externalId,
      occurredAt: new Date(`${d}T00:00:00Z`), payloadRef: `${WS}/gsc/${d}/x`,
      data: { page: "https://forgcv.com/cv", query: "q", clicks: 5, impressions: 400, ctr: 0.0125, position: 14 },
      normalizerVersion: 1, dedupeHash: createHash("sha256").update(`gsc|daily|${externalId}`).digest("hex"),
    }]));
  }
}, 120_000);

afterAll(async () => { await h.stop(); });

describe("complete closed loop with evidence at every step", () => {
  it("runs GSC → detection → growth → acceptance → completion → measurement → grade → learning → knowledge → improved recommendation", async () => {
    // Detection (evidence per finding) → Growth (evidence per opportunity)
    await runDetection({ pool: h.app, workspaceId: WS, now: new Date(`${DAY}T00:00:00Z`), windowDays: 7 });
    const config = new ConfigRegistry(new InMemoryConfigStore()); registerGrowthWeights(config);
    await buildGrowth({ pool: h.app, config, workspaceId: WS, day: DAY });
    const opp = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT id, detectors, evidence_ids, priority_score FROM opportunities LIMIT 1`));
    const opportunityId = opp.rows[0].id as string;
    const detector = (opp.rows[0].detectors as string[])[0]!;
    const basePriority = Number(opp.rows[0].priority_score);
    expect((opp.rows[0].evidence_ids as string[]).length).toBeGreaterThan(0); // evidence at growth

    // Human-configured automation: validate + accept (Law 16; no publishing)
    const registry = buildDefaultActionRegistry(h.app);
    await withWorkspace(h.app, WS, async (tx) => {
      await tx.query(`INSERT INTO automation_rules (workspace_id, name, trigger, condition, action, ladder_level, created_by) VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'validate', '{"type":"opportunity.detected"}'::jsonb, '[]'::jsonb, 'opportunity.validate', 'A2', $1)`, [USER]);
      await tx.query(`INSERT INTO automation_rules (workspace_id, name, trigger, condition, action, ladder_level, created_by) VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'accept', '{"type":"opportunity.validated"}'::jsonb, '[]'::jsonb, 'opportunity.accept', 'A2', $1)`, [USER]);
    });
    await emitOpportunityEvent(h.app, registry, WS, opportunityId, "opportunity.detected");
    await emitOpportunityEvent(h.app, registry, WS, opportunityId, "opportunity.validated");

    // Baseline snapshot at acceptance; then completion
    await snapshotBaseline(h.app, WS, { opportunityId, metric: "ctr", baselineValue: 0.0125, windowDays: 28 });
    await transitionOpportunity(h.app, WS, opportunityId, "completed", "human");

    // Measurement with UTM-independent attribution (GSC-only) → grade
    const resolved = resolveAttribution({ gsc: { value: 0.02 } });
    const outcome = await recordOutcome(h.app, WS, { subjectType: "opportunity", subjectId: opportunityId, metric: "ctr", baselineValue: 0.0125, observedValue: resolved.observedValue, windowDays: 28, targetImprovement: 0.1, attribution: resolved.attribution });
    expect(outcome.verdict).toBe("met");
    expect(outcome.grade).toBe("B"); // GSC-scoped, no UTM
    expect(outcome.evidenceReferenceId).toBeTruthy(); // evidence at measurement

    // Learning propagation → detector track record
    const learned = await propagateLearning(h.app, WS, { minSamples: 1 });
    const tr = learned.find((l) => l.detector === detector)!;
    expect(tr.score).toBeGreaterThan(0);

    // Knowledge: with 1 grade-B sample it stays observation/hypothesis (never validated without grade-A) — honest
    const level = evaluatePromotion({ samples: tr.samples, gradeACount: 0, stable: true, shadowApproved: true });
    expect(level).not.toBe("validated");
    await promoteKnowledge(h.app, WS, `detector:${detector}`, { samples: tr.samples, gradeACount: 0, stable: true, shadowApproved: true }, [outcome.evidenceReferenceId]);
    const kb = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT epistemic_level FROM kb_entries WHERE key = $1`, [`detector:${detector}`]));
    expect(["hypothesis", "observation"]).toContain(kb.rows[0].epistemic_level);

    // Improved recommendation: bounded arbitration tilts the base score by the learned track record, shadow-eval-safe
    const bound = 0.15;
    const improved = arbitrateV2(basePriority, tr.score, bound);
    expect(improved.factor).toBeGreaterThan(1); // positive track record lifts it, bounded
    const shadow = shadowEvaluateArbitration([{ id: opportunityId, base: basePriority, v2: improved.score }], bound);
    expect(shadow.passed).toBe(true); // single item → no forbidden flip; V2 may activate

    // No publishing anywhere in the loop (Law 5)
    const published = await h.admin.query(`SELECT count(*)::int AS n FROM drafts WHERE status = 'published'`);
    expect(published.rows[0].n).toBe(0);
    // Audit trail across the loop
    const audits = await h.admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE workspace_id = $1 AND event IN ('opportunity.transition','learning.propagated','kb.promotion')`, [WS]);
    expect(audits.rows[0].n).toBeGreaterThanOrEqual(4);
  });
});
