/** Connection sync state/metadata (ADR-021 health model). Workspace-scoped. */
import type pg from "pg";

import { withWorkspace } from "../tenancy.js";

export interface SyncState {
  connectionId: string;
  lastSuccessfulSync: Date | null;
  lastAttemptedSync: Date | null;
  lastDurationMs: number | null;
  importedRows: number;
  apiQuotaUsed: number;
  lastError: string | null;
}

export interface SyncStateUpdate {
  lastSuccessfulSync?: Date | null;
  lastAttemptedSync?: Date | null;
  lastDurationMs?: number | null;
  addImportedRows?: number;
  addApiQuotaUsed?: number;
  lastError?: string | null;
}

export async function getSyncState(pool: pg.Pool, workspaceId: string, connectionId: string): Promise<SyncState | null> {
  const r = await withWorkspace(pool, workspaceId, (tx) =>
    tx.query(
      `SELECT connection_id, last_successful_sync, last_attempted_sync, last_duration_ms, imported_rows, api_quota_used, last_error
       FROM connection_sync_state WHERE connection_id = $1`,
      [connectionId],
    ),
  );
  if (!r.rowCount) return null;
  const row = r.rows[0] as Record<string, unknown>;
  return {
    connectionId: row.connection_id as string,
    lastSuccessfulSync: (row.last_successful_sync as Date | null) ?? null,
    lastAttemptedSync: (row.last_attempted_sync as Date | null) ?? null,
    lastDurationMs: (row.last_duration_ms as number | null) ?? null,
    importedRows: Number(row.imported_rows),
    apiQuotaUsed: Number(row.api_quota_used),
    lastError: (row.last_error as string | null) ?? null,
  };
}

/** Upsert. Counters (rows, quota) accumulate; timestamps/error/duration overwrite when provided. */
export async function updateSyncState(
  pool: pg.Pool,
  workspaceId: string,
  connectionId: string,
  patch: SyncStateUpdate,
): Promise<void> {
  await withWorkspace(pool, workspaceId, (tx) =>
    tx.query(
      `INSERT INTO connection_sync_state
         (connection_id, workspace_id, last_successful_sync, last_attempted_sync, last_duration_ms, imported_rows, api_quota_used, last_error, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (connection_id) DO UPDATE SET
         last_successful_sync = COALESCE($3, connection_sync_state.last_successful_sync),
         last_attempted_sync  = COALESCE($4, connection_sync_state.last_attempted_sync),
         last_duration_ms     = COALESCE($5, connection_sync_state.last_duration_ms),
         imported_rows        = connection_sync_state.imported_rows + $6,
         api_quota_used       = connection_sync_state.api_quota_used + $7,
         last_error           = $8,
         updated_at           = now()`,
      [
        connectionId,
        workspaceId,
        patch.lastSuccessfulSync ?? null,
        patch.lastAttemptedSync ?? null,
        patch.lastDurationMs ?? null,
        patch.addImportedRows ?? 0,
        patch.addApiQuotaUsed ?? 0,
        patch.lastError ?? null,
      ],
    ),
  );
}
