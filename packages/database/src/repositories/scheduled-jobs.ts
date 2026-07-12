/** Scheduled jobs — schedules are data (ADR-003, S3 §10). Reader for the worker's tick. */
import type pg from "pg";

import { dangerouslyUnscoped } from "../tenancy.js";

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
