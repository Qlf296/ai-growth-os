/**
 * Automation hooks (STEP 7.4). A domain event (e.g. an opportunity reaching a
 * lifecycle state) drives automation. The hook builds the fact from the
 * opportunity row and runs the workspace's rules idempotently (trigger_ref =
 * opportunityId:triggerType).
 */
import type pg from "pg";

import { withWorkspace } from "@aigos/database";

import type { ActionRegistry } from "./registry.js";
import { runAutomationForEvent, type AutomationRunResult } from "./run.js";

export async function emitOpportunityEvent(
  pool: pg.Pool,
  registry: ActionRegistry,
  workspaceId: string,
  opportunityId: string,
  triggerType: string,
): Promise<AutomationRunResult> {
  const o = await withWorkspace(pool, workspaceId, (tx) =>
    tx.query(`SELECT id, entity, category, severity, confidence, impact, priority_score, status, evidence_ids FROM opportunities WHERE id = $1`, [opportunityId]),
  );
  if (!o.rowCount) throw new Error(`opportunity not found: ${opportunityId}`);
  const row = o.rows[0] as Record<string, unknown>;
  const fact = {
    opportunityId: row.id, entity: row.entity, category: row.category, severity: row.severity,
    confidence: row.confidence, impact: row.impact, priorityScore: Number(row.priority_score),
    status: row.status, evidenceIds: row.evidence_ids,
  };
  return runAutomationForEvent(pool, registry, workspaceId, triggerType, fact, `${opportunityId}:${triggerType}`);
}
