/** Scheduled jobs — schedules are data (ADR-003, S3 §10). Reader for the worker's tick. */
import type pg from "pg";

import { dangerouslyUnscoped, withWorkspace } from "../tenancy.js";

export interface ScheduledJobRow {
  id: string;
  workspaceId: string | null;
  jobFamily: string;
  schedule: string;
  params: Record<string, unknown>;
}

/**
 * System jobs (workspace_id IS NULL) — all the scheduler needs in Phase 0.
 * Per-workspace rows materialize from plans.limits in Phase 1 and will be
 * read per-workspace scope then.
 */
export async function listEnabledSystemJobs(pool: pg.Pool): Promise<ScheduledJobRow[]> {
  const r = await dangerouslyUnscoped(pool, "scheduler tick reads system job definitions (ADR-003)", (tx) =>
    tx.query(
      `SELECT id, workspace_id, job_family, schedule, params
       FROM scheduled_jobs WHERE enabled AND workspace_id IS NULL`,
    ),
  );
  return r.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    workspaceId: row.workspace_id as string | null,
    jobFamily: row.job_family as string,
    schedule: row.schedule as string,
    params: row.params as Record<string, unknown>,
  }));
}

/**
 * Record a run against a workspace job (schedules-as-data metadata): the next
 * synchronization is thereby "scheduled" through the existing scheduler row.
 */
export async function recordJobRun(
  pool: pg.Pool,
  workspaceId: string,
  jobFamily: string,
  status: string,
  nextRunAt: Date,
): Promise<void> {
  await withWorkspace(pool, workspaceId, (tx) =>
    tx.query(
      `UPDATE scheduled_jobs SET last_run_at = now(), last_status = $3, next_run_at = $4
       WHERE workspace_id = $1 AND job_family = $2`,
      [workspaceId, jobFamily, status, nextRunAt],
    ),
  );
}

/**
 * Persist an enabled workspace-scoped recurring job (schedules-as-data,
 * ADR-003). Idempotent per (workspace, job_family, params): connecting the
 * same site twice does not create a duplicate schedule.
 */
export async function scheduleWorkspaceJob(
  pool: pg.Pool,
  input: { workspaceId: string; jobFamily: string; schedule: string; params: Record<string, unknown> },
): Promise<void> {
  await withWorkspace(pool, input.workspaceId, (tx) =>
    tx.query(
      `INSERT INTO scheduled_jobs (workspace_id, job_family, schedule, params, enabled)
       SELECT $1, $2, $3, $4::jsonb, true
       WHERE NOT EXISTS (
         SELECT 1 FROM scheduled_jobs
         WHERE workspace_id = $1 AND job_family = $2 AND params = $4::jsonb
       )`,
      [input.workspaceId, input.jobFamily, input.schedule, JSON.stringify(input.params)],
    ),
  );
}
