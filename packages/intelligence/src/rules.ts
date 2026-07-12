/**
 * Rules as data (STEP 3.2; S3 §5). Detector configuration lives in
 * detector_rules: NULL workspace = global default, a workspace row overrides
 * it. Versioned, prioritized, enable/disable, thresholds as data.
 */
import type pg from "pg";

import { withWorkspace } from "@aigos/database";

export interface DetectorRule {
  readonly detector: string;
  readonly enabled: boolean;
  readonly priority: number;
  readonly version: number;
  readonly thresholds: Record<string, number>;
}

/** Effective rules for a workspace: global rows overridden by workspace rows. */
export async function loadRules(pool: pg.Pool, workspaceId: string): Promise<Map<string, DetectorRule>> {
  const rows = await withWorkspace(pool, workspaceId, (tx) =>
    tx.query(
      `SELECT detector, enabled, priority, version, thresholds, workspace_id
       FROM detector_rules
       ORDER BY (workspace_id IS NOT NULL)`, // globals first, then workspace overrides applied after
    ),
  );
  const merged = new Map<string, DetectorRule>();
  for (const r of rows.rows as Array<Record<string, unknown>>) {
    merged.set(r.detector as string, {
      detector: r.detector as string,
      enabled: r.enabled as boolean,
      priority: r.priority as number,
      version: r.version as number,
      thresholds: (r.thresholds as Record<string, number>) ?? {},
    });
  }
  return merged;
}

/** Upsert a workspace-scoped override (enable/disable, thresholds, version, priority). */
export async function setWorkspaceRule(
  pool: pg.Pool,
  workspaceId: string,
  rule: DetectorRule,
): Promise<void> {
  await withWorkspace(pool, workspaceId, (tx) =>
    tx.query(
      `INSERT INTO detector_rules (workspace_id, detector, enabled, priority, version, thresholds)
       VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (workspace_id, detector) DO UPDATE SET
         enabled = EXCLUDED.enabled, priority = EXCLUDED.priority,
         version = EXCLUDED.version, thresholds = EXCLUDED.thresholds, updated_at = now()`,
      [rule.detector, rule.enabled, rule.priority, rule.version, JSON.stringify(rule.thresholds)],
    ),
  );
}
