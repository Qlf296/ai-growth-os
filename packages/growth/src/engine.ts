/**
 * Growth build (STEP 4.1–4.3, 4.5). Deterministic and idempotent: reads a day's
 * findings, groups them into opportunities (ADR-031), scores/ranks them
 * (Priority Engine), and builds a data-only recommendation each. Re-running the
 * same day changes nothing (dedupe_hash + upsert), so the feed replays exactly.
 */
import type pg from "pg";

import type { ConfigRegistry } from "@aigos/config-registry";
import { withWorkspace } from "@aigos/database";
import { listFindingsForDay } from "@aigos/intelligence";
import type { MetricsRegistry } from "@aigos/infra";

import { buildOpportunities } from "./opportunity.js";
import { loadWeights, score } from "./priority.js";
import { buildRecommendation } from "./recommendation.js";

export interface GrowthBuildParams {
  readonly pool: pg.Pool;
  readonly config: ConfigRegistry;
  readonly workspaceId: string;
  readonly day: string; // YYYY-MM-DD
  readonly metrics?: MetricsRegistry;
}

export interface GrowthBuildSummary {
  readonly opportunities: number;
  readonly recommendations: number;
  readonly day: string;
}

export async function buildGrowth(params: GrowthBuildParams): Promise<GrowthBuildSummary> {
  const findings = await listFindingsForDay(params.pool, params.workspaceId, params.day);
  const drafts = buildOpportunities(findings, params.day);
  const weights = await loadWeights(params.config, params.workspaceId);

  let opportunities = 0;
  let recommendations = 0;

  await withWorkspace(params.pool, params.workspaceId, async (tx) => {
    for (const d of drafts) {
      const scored = score({ severity: d.severity, confidence: d.confidence, impact: d.impact, effort: d.effort }, weights);
      const oppRow = await tx.query(
        `INSERT INTO opportunities
           (workspace_id, entity, category, detectors, severity, confidence, impact, difficulty, effort, roi, priority_score, score_trace, evidence_ids, occurred_on, dedupe_hash)
         VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12::jsonb, $13, $14)
         ON CONFLICT (workspace_id, dedupe_hash) DO UPDATE SET
           priority_score = EXCLUDED.priority_score, score_trace = EXCLUDED.score_trace, updated_at = now()
         RETURNING id`,
        [d.entity, d.category, JSON.stringify(d.detectors), d.severity, d.confidence, d.impact, d.difficulty, d.effort,
         JSON.stringify(d.roi), scored.score, JSON.stringify(scored.trace), JSON.stringify(d.evidenceIds), d.occurredOn, d.dedupeHash],
      );
      opportunities += 1;
      const opportunityId = (oppRow.rows[0] as { id: string }).id;

      const rec = buildRecommendation(d);
      const recRow = await tx.query(
        `INSERT INTO recommendations
           (workspace_id, opportunity_id, title, summary, business_reason, technical_reason, expected_impact, evidence_ids, affected_entities, prerequisites, steps, rollback)
         VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11)
         ON CONFLICT (workspace_id, opportunity_id) DO NOTHING`,
        [opportunityId, rec.title, rec.summary, rec.businessReason, rec.technicalReason, rec.expectedImpact,
         JSON.stringify(rec.evidenceIds), JSON.stringify(rec.affectedEntities), JSON.stringify(rec.prerequisites), JSON.stringify(rec.steps), rec.rollback],
      );
      recommendations += recRow.rowCount ?? 0;
    }
  });

  params.metrics?.counter("growth.opportunities").inc(opportunities);
  return { opportunities, recommendations, day: params.day };
}
