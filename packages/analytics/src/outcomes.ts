/**
 * Outcome measurement (STEP 8.1; S3 §7). Records a measured outcome for a
 * subject (opportunity/experiment) against its baseline, producing evidence
 * (ADR-035, I4) and an honest verdict (ADR-025 measurement ≠ interpretation;
 * 'unmeasurable' when data is missing — never fabricated). Idempotent.
 */
import { createHash } from "node:crypto";

import { withWorkspace } from "@aigos/database";
import { makeEvidence } from "@aigos/intelligence";

import { gradeOutcome, type Attribution, type Grade } from "./grade.js";
import type pg from "pg";

export type SubjectType = "opportunity" | "experiment";
export type Verdict = "met" | "partial" | "not_met" | "unmeasurable";

export interface MeasureInput {
  subjectType: SubjectType;
  subjectId: string;
  metric: string;
  baselineValue: number | null;   // snapshotted at subject creation
  observedValue: number | null;   // measured now
  windowDays: number;
  /** Fraction improvement over baseline that counts as fully "met" (e.g. 0.1 = +10%). */
  targetImprovement: number;
  /** Attribution context (ADR-033). Default: scoped GSC correlation, no UTM, no confounders. */
  attribution?: Attribution;
}

export interface OutcomeRecord {
  id: string;
  verdict: Verdict;
  grade: Grade;
  deltaPct: number | null;
  evidenceReferenceId: string;
}

/** Deterministic verdict from measured values only (no interpretation beyond the criterion). */
export function verdictFor(input: MeasureInput): { verdict: Verdict; deltaPct: number | null } {
  if (input.baselineValue === null || input.observedValue === null || input.baselineValue === 0) {
    return { verdict: "unmeasurable", deltaPct: null };
  }
  const delta = (input.observedValue - input.baselineValue) / input.baselineValue;
  if (delta >= input.targetImprovement) return { verdict: "met", deltaPct: delta };
  if (delta > 0) return { verdict: "partial", deltaPct: delta };
  return { verdict: "not_met", deltaPct: delta };
}

export async function recordOutcome(pool: pg.Pool, workspaceId: string, input: MeasureInput): Promise<OutcomeRecord> {
  const { verdict, deltaPct } = verdictFor(input);
  const attribution: Attribution = input.attribution ?? { pageScoped: true, utmKeyed: false, confounders: 0 };
  const grade = gradeOutcome(attribution, verdict);
  const evidence = makeEvidence({
    generatedBy: "analytics.outcome@1",
    data: {
      subjectType: input.subjectType, subjectId: input.subjectId, metric: input.metric,
      baseline: input.baselineValue, observed: input.observedValue, windowDays: input.windowDays,
      targetImprovement: input.targetImprovement, deltaPct, verdict, grade, unit: "measured", monetized: false,
    },
  });
  const dedupeHash = createHash("sha256").update(`${input.subjectType}|${input.subjectId}|${input.metric}|${input.windowDays}`).digest("hex");

  return withWorkspace(pool, workspaceId, async (tx) => {
    await tx.query(
      `INSERT INTO evidence (id, workspace_id, generated_by, data)
       VALUES ($1, NULLIF(current_setting('app.workspace_id', true), '')::uuid, $2, $3::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [evidence.id, evidence.generatedBy, JSON.stringify(evidence.data)],
    );
    await tx.query(
      `INSERT INTO outcome_evaluations (workspace_id, subject_type, subject_id, metric, baseline_value, observed_value, window_days, verdict, grade, evidence_id, dedupe_hash)
       VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (workspace_id, dedupe_hash) DO NOTHING`,
      [input.subjectType, input.subjectId, input.metric, input.baselineValue, input.observedValue, input.windowDays, verdict, grade, evidence.id, dedupeHash],
    );
    const row = await tx.query(`SELECT id, verdict, grade, evidence_id FROM outcome_evaluations WHERE dedupe_hash = $1`, [dedupeHash]);
    const r = row.rows[0] as { id: string | number; verdict: Verdict; grade: Grade; evidence_id: string };
    return { id: String(r.id), verdict: r.verdict, grade: r.grade, deltaPct, evidenceReferenceId: r.evidence_id };
  });
}
