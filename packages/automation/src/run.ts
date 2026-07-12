/**
 * DB-backed automation run (STEP 7.3). Loads a workspace's enabled rules,
 * evaluates them against a trigger event, and persists each outcome to
 * automation_executions idempotently (UNIQUE(workspace, rule, trigger_ref)).
 * A rule that already ran for this trigger_ref is skipped — safe under queue
 * retries and replays.
 */
import type pg from "pg";

import { withWorkspace } from "@aigos/database";

import { evaluateRules } from "./engine.js";
import type { ActionRegistry } from "./registry.js";
import type { AutomationRule } from "./model.js";

export async function loadEnabledRules(pool: pg.Pool, workspaceId: string): Promise<AutomationRule[]> {
  const r = await withWorkspace(pool, workspaceId, (tx) =>
    tx.query(`SELECT id, name, trigger, condition, action, ladder_level, enabled FROM automation_rules WHERE enabled ORDER BY created_at`),
  );
  return (r.rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string, workspaceId, name: row.name as string,
    trigger: row.trigger as AutomationRule["trigger"], condition: row.condition as AutomationRule["condition"],
    action: row.action as string, ladderLevel: row.ladder_level as AutomationRule["ladderLevel"], enabled: row.enabled as boolean,
  }));
}

export interface AutomationRunResult {
  ran: number;
  skipped: number;
  errors: number;
}

export async function runAutomationForEvent(
  pool: pg.Pool,
  registry: ActionRegistry,
  workspaceId: string,
  triggerType: string,
  fact: Record<string, unknown>,
  triggerRef: string,
): Promise<AutomationRunResult> {
  const rules = await loadEnabledRules(pool, workspaceId);
  const alreadyExecuted = async (ruleId: string): Promise<boolean> => {
    const r = await withWorkspace(pool, workspaceId, (tx) =>
      tx.query(`SELECT 1 FROM automation_executions WHERE rule_id = $1 AND trigger_ref = $2`, [ruleId, triggerRef]),
    );
    return (r.rowCount ?? 0) > 0;
  };

  const records = await evaluateRules(registry, rules, triggerType, fact, workspaceId, { alreadyExecuted });

  let ran = 0, skipped = 0, errors = 0;
  for (const rec of records) {
    if (rec.detail.reason === "already_executed") { skipped += 1; continue; }
    // Persist idempotently; a concurrent duplicate is ignored by the UNIQUE constraint.
    await withWorkspace(pool, workspaceId, (tx) =>
      tx.query(
        `INSERT INTO automation_executions (workspace_id, rule_id, trigger_ref, status, result)
         VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, $2, $3, $4::jsonb)
         ON CONFLICT (workspace_id, rule_id, trigger_ref) DO NOTHING`,
        [rec.ruleId, triggerRef, rec.status, JSON.stringify(rec.detail)],
      ),
    );
    if (rec.status === "ok") ran += 1;
    else if (rec.status === "skipped") skipped += 1;
    else errors += 1;
  }
  return { ran, skipped, errors };
}
