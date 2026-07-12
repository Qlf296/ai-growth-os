/** STEP 8.3 — Learning Propagator: grade-weighted, bounded, min-samples abstention, detector health, one writer, audited, RLS. */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withWorkspace } from "@aigos/database";

import { propagateLearning, recordOutcome } from "../src/index.js";
import { startHarness, seedWorkspace, type Harness } from "../../database/test/harness.js";

let h: Harness;
const WS = randomUUID();
const OTHER = randomUUID();

async function opportunityWithOutcome(detector: string, verdict: "met" | "not_met", grade_utm = false): Promise<void> {
  const ev = randomUUID();
  const id = randomUUID();
  await withWorkspace(h.app, WS, async (tx) => {
    await tx.query(`INSERT INTO evidence (id, workspace_id, generated_by, data) VALUES ($1, NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'x@1', '{}'::jsonb)`, [ev]);
    await tx.query(`INSERT INTO opportunities (id, workspace_id, entity, category, detectors, severity, confidence, impact, difficulty, effort, roi, priority_score, score_trace, evidence_ids, occurred_on, dedupe_hash) VALUES ($4, NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'e', 'seo', $1::jsonb, 'low', 'medium', 'medium', 'low', 'low', '{}'::jsonb, 0.5, '{}'::jsonb, $2::jsonb, '2026-07-12', $3) RETURNING id`, [JSON.stringify([detector]), JSON.stringify([ev]), randomUUID(), id]);
  });
  const observed = verdict === "met" ? 0.05 : 0.01;
  await recordOutcome(h.app, WS, { subjectType: "opportunity", subjectId: id, metric: "ctr", baselineValue: 0.02, observedValue: observed, windowDays: 28, targetImprovement: 0.1, attribution: { pageScoped: true, utmKeyed: grade_utm, confounders: 0 } });
}

beforeAll(async () => { h = await startHarness(); await seedWorkspace(h.admin, WS, "ws"); await seedWorkspace(h.admin, OTHER, "o"); }, 120_000);
afterAll(async () => { await h.stop(); });

describe("propagateLearning", () => {
  it("computes grade-weighted score, abstains below the min-samples floor", async () => {
    for (let i = 0; i < 6; i++) await opportunityWithOutcome("seo.ctr_gap", "met", true); // grade A, met → score 1
    await opportunityWithOutcome("seo.striking_distance", "met", true); // only 1 sample → insufficient
    const learned = await propagateLearning(h.app, WS, { minSamples: 5 });
    const ctr = learned.find((l) => l.detector === "seo.ctr_gap")!;
    expect(ctr.samples).toBe(6);
    expect(ctr.score).toBeCloseTo(1);
    expect(ctr.health).toBe("healthy");
    const sd = learned.find((l) => l.detector === "seo.striking_distance")!;
    expect(sd.score).toBeNull();
    expect(sd.health).toBe("insufficient_data");
  });

  it("a detector with all-failed outcomes becomes a retire_candidate; single writer + audit", async () => {
    for (let i = 0; i < 5; i++) await opportunityWithOutcome("seo.click_drop", "not_met", true);
    const learned = await propagateLearning(h.app, WS, { minSamples: 5 });
    const cd = learned.find((l) => l.detector === "seo.click_drop")!;
    expect(cd.score).toBe(0);
    expect(cd.health).toBe("retire_candidate");
    const tr = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT health FROM detector_track_record WHERE detector = 'seo.click_drop'`));
    expect(tr.rows[0].health).toBe("retire_candidate");
    const audit = await h.admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE event = 'learning.propagated' AND workspace_id = $1`, [WS]);
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it("RLS: another workspace has no track record", async () => {
    await propagateLearning(h.app, WS);
    expect((await withWorkspace(h.app, OTHER, (tx) => tx.query(`SELECT * FROM detector_track_record`))).rowCount).toBe(0);
  });
});
