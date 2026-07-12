/**
 * Analytics reads for the Learnings surface / reports (STEP 8.4; S11/S17).
 * Repository-only. Every rendered claim carries its evidence_reference_id
 * (I4). Honest track record ("of N completed, M met their target") and grade
 * distribution — measured units only (Law 15).
 */
import { withWorkspace } from "@aigos/database";
import type pg from "pg";

export interface OutcomeReportRow {
  subjectType: string;
  subjectId: string;
  metric: string;
  verdict: string;
  grade: string | null;
  evidenceReferenceId: string;
  evaluatedAt: string;
}

export interface TrackRecordRow { detector: string; score: number | null; samples: number; health: string; }

export interface AnalyticsSummary {
  totalMeasured: number;
  met: number;
  partial: number;
  notMet: number;
  unmeasurable: number;
  gradeCounts: Record<string, number>;
  outcomes: OutcomeReportRow[];
  trackRecord: TrackRecordRow[];
}

export async function analyticsSummary(pool: pg.Pool, workspaceId: string, limit = 50): Promise<AnalyticsSummary> {
  return withWorkspace(pool, workspaceId, async (tx) => {
    const agg = await tx.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE verdict = 'met')::int AS met,
         count(*) FILTER (WHERE verdict = 'partial')::int AS partial,
         count(*) FILTER (WHERE verdict = 'not_met')::int AS not_met,
         count(*) FILTER (WHERE verdict = 'unmeasurable')::int AS unmeasurable
       FROM outcome_evaluations`,
    );
    const grades = await tx.query(`SELECT grade, count(*)::int AS n FROM outcome_evaluations WHERE grade IS NOT NULL GROUP BY grade`);
    const rows = await tx.query(
      `SELECT subject_type, subject_id, metric, verdict, grade, evidence_id, evaluated_at
       FROM outcome_evaluations ORDER BY evaluated_at DESC LIMIT $1`,
      [limit],
    );
    const tr = await tx.query(`SELECT detector, score, samples, health FROM detector_track_record ORDER BY detector`);
    const a = agg.rows[0] as Record<string, number>;
    const gradeCounts: Record<string, number> = {};
    for (const g of grades.rows as Array<{ grade: string; n: number }>) gradeCounts[g.grade] = g.n;
    return {
      totalMeasured: Number(a.total ?? 0), met: Number(a.met ?? 0), partial: Number(a.partial ?? 0),
      notMet: Number(a.not_met ?? 0), unmeasurable: Number(a.unmeasurable ?? 0),
      gradeCounts,
      outcomes: (rows.rows as Array<Record<string, unknown>>).map((r) => ({
        subjectType: r.subject_type as string, subjectId: r.subject_id as string, metric: r.metric as string,
        verdict: r.verdict as string, grade: (r.grade as string | null) ?? null, evidenceReferenceId: r.evidence_id as string,
        evaluatedAt: (r.evaluated_at as Date).toISOString(),
      })),
      trackRecord: (tr.rows as Array<Record<string, unknown>>).map((r) => ({
        detector: r.detector as string, score: (r.score as number | null) ?? null, samples: r.samples as number, health: r.health as string,
      })),
    };
  });
}
