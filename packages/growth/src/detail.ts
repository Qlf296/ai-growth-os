/**
 * Opportunity detail reader (STEP 6.2). Repository-only. Assembles the
 * opportunity, its recommendation, its evidence rows and its immutable
 * lifecycle timeline (from the append-only audit log). Every evidence id on
 * the opportunity MUST resolve to an evidence row — a missing reference fails
 * loudly (I4: no claim without evidence).
 */
import type pg from "pg";

import { withWorkspace } from "@aigos/database";

export interface EvidenceRow {
  evidenceReferenceId: string;
  generatedBy: string;
  data: Record<string, unknown>;
}

export interface TimelineEntry {
  from: string;
  to: string;
  reason: string;
  at: string;
}

export interface OpportunityDetail {
  id: string;
  entity: string;
  category: string;
  severity: string;
  confidence: string;
  impact: string;
  effort: string;
  priorityScore: number;
  status: string;
  scoreTrace: Record<string, unknown>;
  detectors: string[];
  recommendation: {
    title: string; summary: string; businessReason: string; technicalReason: string;
    expectedImpact: string; steps: string[]; prerequisites: string[]; rollback: string;
  } | null;
  evidence: EvidenceRow[];
  timeline: TimelineEntry[];
}

export async function getOpportunityDetail(pool: pg.Pool, workspaceId: string, opportunityId: string): Promise<OpportunityDetail | null> {
  return withWorkspace(pool, workspaceId, async (tx) => {
    const o = await tx.query(
      `SELECT id, entity, category, severity, confidence, impact, effort, priority_score, status, score_trace, detectors, evidence_ids
       FROM opportunities WHERE id = $1`,
      [opportunityId],
    );
    if (!o.rowCount) return null;
    const row = o.rows[0] as Record<string, unknown>;
    const evidenceIds = row.evidence_ids as string[];

    const ev = await tx.query(`SELECT id, generated_by, data FROM evidence WHERE id = ANY($1::uuid[])`, [evidenceIds]);
    const byId = new Map((ev.rows as Array<Record<string, unknown>>).map((e) => [e.id as string, e]));
    const evidence: EvidenceRow[] = evidenceIds.map((id) => {
      const e = byId.get(id);
      if (!e) throw new Error(`missing evidence reference ${id} for opportunity ${opportunityId} (I4)`);
      return { evidenceReferenceId: id, generatedBy: e.generated_by as string, data: e.data as Record<string, unknown> };
    });

    const rec = await tx.query(
      `SELECT title, summary, business_reason, technical_reason, expected_impact, steps, prerequisites, rollback
       FROM recommendations WHERE opportunity_id = $1`,
      [opportunityId],
    );
    const r = rec.rows[0] as Record<string, unknown> | undefined;

    const tl = await tx.query(
      `SELECT details, at FROM audit_log WHERE event = 'opportunity.transition' AND details->>'opportunityId' = $1 ORDER BY id`,
      [opportunityId],
    );
    const timeline: TimelineEntry[] = (tl.rows as Array<{ details: Record<string, unknown>; at: Date }>).map((t) => ({
      from: t.details.from as string, to: t.details.to as string, reason: (t.details.reason as string) ?? "", at: t.at.toISOString(),
    }));

    return {
      id: row.id as string,
      entity: row.entity as string,
      category: row.category as string,
      severity: row.severity as string,
      confidence: row.confidence as string,
      impact: row.impact as string,
      effort: row.effort as string,
      priorityScore: Number(row.priority_score),
      status: row.status as string,
      scoreTrace: row.score_trace as Record<string, unknown>,
      detectors: row.detectors as string[],
      recommendation: r ? {
        title: r.title as string, summary: r.summary as string, businessReason: r.business_reason as string,
        technicalReason: r.technical_reason as string, expectedImpact: r.expected_impact as string,
        steps: r.steps as string[], prerequisites: r.prerequisites as string[], rollback: r.rollback as string,
      } : null,
      evidence,
      timeline,
    };
  });
}
