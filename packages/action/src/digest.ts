/**
 * Daily AI Digest (STEP 5.5). Reuses the growth feed and adds generated drafts,
 * pending approvals and completed actions. Deterministic and replay-safe: it is
 * a pure read over persisted rows. Assembly only — Delivery remains the sole
 * sender (I7); this returns a structured object.
 */
import type pg from "pg";

import { withWorkspace } from "@aigos/database";
import { buildFeed, type Feed } from "@aigos/growth";

export interface DigestDraft {
  id: string;
  draftType: string;
  status: string;
  recommendationId: string;
}

/** Honest outcome report-back (STEP 9.5): measured units only — verdict, grade, evidence. Never ROI. */
export interface ReportBack {
  metric: string;
  verdict: string;
  grade: string | null;
  evidenceReferenceId: string;
  measuredAt: string;
}

export interface Digest {
  day: string;
  feed: Feed;
  opportunities: number;
  recommendations: number;
  drafts: DigestDraft[];
  pendingApprovals: DigestDraft[];
  completed: number;
  reportBacks: ReportBack[];
}

export async function buildDigest(pool: pg.Pool, workspaceId: string, day: string): Promise<Digest> {
  const feed = await buildFeed(pool, workspaceId, day, { pageSize: 3 });
  return withWorkspace(pool, workspaceId, async (tx) => {
    const opp = await tx.query(`SELECT count(*)::int AS n FROM opportunities WHERE occurred_on = $1`, [day]);
    const rec = await tx.query(`SELECT count(*)::int AS n FROM recommendations`);
    const completed = await tx.query(`SELECT count(*)::int AS n FROM opportunities WHERE occurred_on = $1 AND status = 'completed'`, [day]);
    const draftRows = await tx.query(`SELECT id, draft_type, status, recommendation_id FROM drafts ORDER BY created_at`);
    const drafts: DigestDraft[] = (draftRows.rows as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string, draftType: r.draft_type as string, status: r.status as string, recommendationId: r.recommendation_id as string,
    }));
    // Honest report-backs: measured outcomes with grade + mandatory evidence reference (I4). No ROI, no money.
    const rb = await tx.query(
      `SELECT metric, verdict, grade, evidence_id, evaluated_at FROM outcome_evaluations ORDER BY evaluated_at DESC LIMIT 10`,
    );
    const reportBacks: ReportBack[] = (rb.rows as Array<Record<string, unknown>>).map((r) => ({
      metric: r.metric as string, verdict: r.verdict as string, grade: (r.grade as string | null) ?? null,
      evidenceReferenceId: r.evidence_id as string, measuredAt: (r.evaluated_at as Date).toISOString(),
    }));
    return {
      day,
      feed,
      opportunities: opp.rows[0].n,
      recommendations: rec.rows[0].n,
      drafts,
      pendingApprovals: drafts.filter((d) => d.status === "draft" || d.status === "reviewed"),
      completed: completed.rows[0].n,
      reportBacks,
    };
  });
}
