/**
 * Experiment Engine (STEP 7.2). A/B experiments with a lifecycle, variants,
 * deterministic per-unit assignments and metrics. Assignment is a pure hash of
 * (experimentId, unit) → variant, so replays are stable. Lifecycle transitions
 * are audited.
 */
import { createHash } from "node:crypto";

import type pg from "pg";

import { withWorkspace } from "@aigos/database";

export type ExperimentStatus = "running" | "completed" | "archived";

export interface CreateExperimentInput {
  recommendationId?: string;
  hypothesis: string;
  expectedImpact: string;
  confidence: "low" | "medium" | "high";
  metric: string;
  variants: { label: string; payload?: Record<string, unknown> }[];
}

export interface Experiment {
  id: string;
  status: ExperimentStatus;
  variants: { id: string; label: string }[];
}

export async function createExperiment(pool: pg.Pool, workspaceId: string, input: CreateExperimentInput): Promise<Experiment> {
  if (input.variants.length < 2) throw new Error("an experiment needs at least two variants");
  return withWorkspace(pool, workspaceId, async (tx) => {
    const e = await tx.query(
      `INSERT INTO experiments (workspace_id, recommendation_id, hypothesis, expected_impact, confidence, metric)
       VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, $2, $3, $4, $5) RETURNING id, status`,
      [input.recommendationId ?? null, input.hypothesis, input.expectedImpact, input.confidence, input.metric],
    );
    const id = (e.rows[0] as { id: string }).id;
    const variants: { id: string; label: string }[] = [];
    for (const v of input.variants) {
      const r = await tx.query(
        `INSERT INTO experiment_variants (experiment_id, workspace_id, label, payload)
         VALUES ($1, NULLIF(current_setting('app.workspace_id', true), '')::uuid, $2, $3::jsonb) RETURNING id`,
        [id, v.label, JSON.stringify(v.payload ?? {})],
      );
      variants.push({ id: (r.rows[0] as { id: string }).id, label: v.label });
    }
    return { id, status: (e.rows[0] as { status: ExperimentStatus }).status, variants };
  });
}

/** Deterministic assignment: same (experiment, unit) always maps to the same variant; persisted once. */
export async function assignVariant(pool: pg.Pool, workspaceId: string, experimentId: string, unit: string): Promise<string> {
  return withWorkspace(pool, workspaceId, async (tx) => {
    const existing = await tx.query(`SELECT variant_id FROM experiment_assignments WHERE experiment_id = $1 AND unit = $2`, [experimentId, unit]);
    if (existing.rowCount) return (existing.rows[0] as { variant_id: string }).variant_id;
    const vs = await tx.query(`SELECT id FROM experiment_variants WHERE experiment_id = $1 ORDER BY label`, [experimentId]);
    if (!vs.rowCount) throw new Error(`experiment ${experimentId} has no variants`);
    const ids = (vs.rows as Array<{ id: string }>).map((r) => r.id);
    const bucket = parseInt(createHash("sha256").update(`${experimentId}|${unit}`).digest("hex").slice(0, 8), 16) % ids.length;
    const variantId = ids[bucket]!;
    await tx.query(
      `INSERT INTO experiment_assignments (experiment_id, workspace_id, unit, variant_id)
       VALUES ($1, NULLIF(current_setting('app.workspace_id', true), '')::uuid, $2, $3)
       ON CONFLICT (experiment_id, unit) DO NOTHING`,
      [experimentId, unit, variantId],
    );
    const now = await tx.query(`SELECT variant_id FROM experiment_assignments WHERE experiment_id = $1 AND unit = $2`, [experimentId, unit]);
    return (now.rows[0] as { variant_id: string }).variant_id;
  });
}

export async function recordMetric(pool: pg.Pool, workspaceId: string, experimentId: string, variantId: string, metric: string, value: number): Promise<void> {
  await withWorkspace(pool, workspaceId, (tx) =>
    tx.query(
      `INSERT INTO experiment_metrics (experiment_id, variant_id, workspace_id, metric, value)
       VALUES ($1, $2, NULLIF(current_setting('app.workspace_id', true), '')::uuid, $3, $4)`,
      [experimentId, variantId, metric, value],
    ),
  );
}

const NEXT: Record<ExperimentStatus, readonly ExperimentStatus[]> = {
  running: ["completed", "archived"],
  completed: ["archived"],
  archived: [],
};

export async function transitionExperiment(pool: pg.Pool, workspaceId: string, experimentId: string, to: ExperimentStatus, reason: string, winnerVariantId?: string): Promise<void> {
  await withWorkspace(pool, workspaceId, async (tx) => {
    const cur = await tx.query(`SELECT status FROM experiments WHERE id = $1`, [experimentId]);
    if (!cur.rowCount) throw new Error(`experiment not found: ${experimentId}`);
    const from = (cur.rows[0] as { status: ExperimentStatus }).status;
    if (!NEXT[from].includes(to)) throw new Error(`illegal experiment transition ${from} → ${to}`);
    await tx.query(
      `UPDATE experiments SET status = $2, winner_variant_id = COALESCE($3, winner_variant_id), decided_at = CASE WHEN $2 = 'completed' THEN now() ELSE decided_at END WHERE id = $1`,
      [experimentId, to, winnerVariantId ?? null],
    );
    await tx.query(
      `INSERT INTO audit_log (workspace_id, actor, event, details) VALUES ($1, 'experiment', 'experiment.transition', $2::jsonb)`,
      [workspaceId, JSON.stringify({ experimentId, from, to, reason, winnerVariantId: winnerVariantId ?? null })],
    );
  });
}
