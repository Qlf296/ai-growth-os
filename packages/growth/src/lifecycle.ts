/**
 * Recommendation/opportunity lifecycle (STEP 4.4). Every transition is audited.
 * A human owns the decision (Law 16): the system detects/validates; accept/
 * reject/postpone/complete are recorded, never auto-taken.
 */
import type pg from "pg";

import { withWorkspace } from "@aigos/database";

export type OpportunityStatus =
  | "detected" | "validated" | "accepted" | "rejected" | "postponed" | "completed" | "expired";

const ALLOWED: Record<OpportunityStatus, readonly OpportunityStatus[]> = {
  detected: ["validated", "rejected", "expired"],
  validated: ["accepted", "rejected", "postponed", "expired"],
  postponed: ["accepted", "rejected", "expired"],
  accepted: ["completed", "rejected", "expired"],
  rejected: [],
  completed: [],
  expired: [],
};

export interface Transition {
  changed: boolean;
  from: OpportunityStatus;
  to: OpportunityStatus;
}

export async function transitionOpportunity(
  pool: pg.Pool,
  workspaceId: string,
  opportunityId: string,
  to: OpportunityStatus,
  reason: string,
): Promise<Transition> {
  return withWorkspace(pool, workspaceId, async (tx) => {
    const cur = await tx.query(`SELECT status FROM opportunities WHERE id = $1`, [opportunityId]);
    if (!cur.rowCount) throw new Error(`opportunity not found: ${opportunityId}`);
    const from = (cur.rows[0] as { status: OpportunityStatus }).status;
    if (from === to) return { changed: false, from, to };
    if (!ALLOWED[from].includes(to)) throw new Error(`illegal opportunity transition ${from} → ${to}`);
    await tx.query(`UPDATE opportunities SET status = $2, updated_at = now() WHERE id = $1`, [opportunityId, to]);
    await tx.query(
      `INSERT INTO audit_log (workspace_id, actor, event, details) VALUES ($1, 'growth', 'opportunity.transition', $2::jsonb)`,
      [workspaceId, JSON.stringify({ opportunityId, from, to, reason })],
    );
    return { changed: true, from, to };
  });
}
