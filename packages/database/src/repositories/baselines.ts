/**
 * Opportunity baseline snapshots (S3 §7). Write-once and immutable: the first
 * snapshot for (opportunity, metric) wins; later attempts are no-ops. The
 * snapshot hash is a deterministic function of the content, so replays are safe.
 */
import { createHash } from "node:crypto";

import { withWorkspace } from "../tenancy.js";
import type pg from "pg";

export interface BaselineInput {
  opportunityId: string;
  metric: string;
  baselineValue: number | null;
  windowDays: number;
}

export interface Baseline extends BaselineInput {
  id: string;
  snapshotHash: string;
  capturedAt: string;
}

export function baselineHash(input: BaselineInput): string {
  return createHash("sha256")
    .update(`${input.opportunityId}|${input.metric}|${input.baselineValue ?? "null"}|${input.windowDays}`)
    .digest("hex");
}

/** Snapshot once; returns the stored (possibly pre-existing) baseline. */
export async function snapshotBaseline(pool: pg.Pool, workspaceId: string, input: BaselineInput): Promise<Baseline> {
  const snapshotHash = baselineHash(input);
  return withWorkspace(pool, workspaceId, async (tx) => {
    await tx.query(
      `INSERT INTO opportunity_baselines (workspace_id, opportunity_id, metric, baseline_value, window_days, snapshot_hash)
       VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, opportunity_id, metric) DO NOTHING`,
      [input.opportunityId, input.metric, input.baselineValue, input.windowDays, snapshotHash],
    );
    const r = await tx.query(
      `SELECT id, opportunity_id, metric, baseline_value, window_days, snapshot_hash, captured_at
       FROM opportunity_baselines WHERE opportunity_id = $1 AND metric = $2`,
      [input.opportunityId, input.metric],
    );
    const row = r.rows[0] as Record<string, unknown>;
    return {
      id: row.id as string, opportunityId: row.opportunity_id as string, metric: row.metric as string,
      baselineValue: row.baseline_value === null || row.baseline_value === undefined ? null : Number(row.baseline_value), windowDays: row.window_days as number,
      snapshotHash: row.snapshot_hash as string, capturedAt: (row.captured_at as Date).toISOString(),
    };
  });
}

export async function getBaseline(pool: pg.Pool, workspaceId: string, opportunityId: string, metric: string): Promise<Baseline | null> {
  const r = await withWorkspace(pool, workspaceId, (tx) =>
    tx.query(`SELECT id, opportunity_id, metric, baseline_value, window_days, snapshot_hash, captured_at FROM opportunity_baselines WHERE opportunity_id = $1 AND metric = $2`, [opportunityId, metric]),
  );
  if (!r.rowCount) return null;
  const row = r.rows[0] as Record<string, unknown>;
  return {
    id: row.id as string, opportunityId: row.opportunity_id as string, metric: row.metric as string,
    baselineValue: row.baseline_value === null || row.baseline_value === undefined ? null : Number(row.baseline_value), windowDays: row.window_days as number,
    snapshotHash: row.snapshot_hash as string, capturedAt: (row.captured_at as Date).toISOString(),
  };
}
