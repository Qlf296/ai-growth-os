/**
 * PgConfigStore — Postgres-backed ConfigStore (ADR-046), the production
 * counterpart of InMemoryConfigStore from step 2. Append-only is enforced by
 * GRANT (app role: SELECT+INSERT only on config_overrides), not by politeness.
 * The ConfigRegistry remains the single writer (I5).
 *
 * config_overrides is RLS-protected like every tenant table (I9): workspace
 * rows are visible/writable only inside that workspace's transaction scope,
 * so every query here runs through withWorkspace / dangerouslyUnscoped.
 */
import type pg from "pg";

import type { ConfigChangeRecord, ConfigStore, ReadScope } from "@aigos/config-registry";

import { dangerouslyUnscoped, withWorkspace, type Tx } from "./tenancy.js";

interface Row {
  key: string;
  value: unknown;
  workspace_id: string | null;
  changed_by: string;
  reason: string;
  shadow_eval_ref: string | null;
  changed_at: Date;
}

const toRecord = (r: Row): ConfigChangeRecord => ({
  key: r.key,
  value: r.value,
  changedBy: r.changed_by,
  reason: r.reason,
  shadowEvalRef: r.shadow_eval_ref,
  workspaceId: r.workspace_id,
  changedAt: r.changed_at.toISOString(),
});

export class PgConfigStore implements ConfigStore {
  constructor(private readonly pool: pg.Pool) {}

  /** Global reads/writes have no workspace scope; RLS still admits global rows. */
  private run<T>(workspaceId: string | null | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return workspaceId
      ? withWorkspace(this.pool, workspaceId, fn)
      : dangerouslyUnscoped(this.pool, "config-registry global scope (ADR-046)", fn);
  }

  async getOverride(key: string, workspaceId: string | null): Promise<unknown | undefined> {
    const result = await this.run(workspaceId, (tx) =>
      tx.query(
        `SELECT value FROM config_overrides
         WHERE key = $1 AND workspace_id IS NOT DISTINCT FROM $2
         ORDER BY id DESC LIMIT 1`,
        [key, workspaceId],
      ),
    );
    return result.rowCount ? (result.rows[0] as Row).value : undefined;
  }

  async setOverride(record: ConfigChangeRecord): Promise<void> {
    await this.run(record.workspaceId, (tx) =>
      tx.query(
        `INSERT INTO config_overrides (key, value, workspace_id, changed_by, reason, shadow_eval_ref, changed_at)
         VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7)`,
        [
          record.key,
          JSON.stringify(record.value),
          record.workspaceId,
          record.changedBy,
          record.reason,
          record.shadowEvalRef,
          record.changedAt,
        ],
      ),
    );
  }

  async history(key: string, scope: ReadScope = {}): Promise<readonly ConfigChangeRecord[]> {
    const result = await this.run(scope.workspaceId ?? null, (tx) =>
      tx.query(
        `SELECT key, value, workspace_id, changed_by, reason, shadow_eval_ref, changed_at
         FROM config_overrides WHERE key = $1 ORDER BY id ASC`,
        [key],
      ),
    );
    return Object.freeze((result.rows as Row[]).map(toRecord));
  }

  async allOverrides(scope: ReadScope = {}): Promise<readonly ConfigChangeRecord[]> {
    const result = await this.run(scope.workspaceId ?? null, (tx) =>
      tx.query(
        `SELECT key, value, workspace_id, changed_by, reason, shadow_eval_ref, changed_at
         FROM config_overrides ORDER BY id ASC`,
      ),
    );
    return Object.freeze((result.rows as Row[]).map(toRecord));
  }
}
