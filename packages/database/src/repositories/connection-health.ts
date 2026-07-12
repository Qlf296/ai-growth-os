/**
 * Connection health transitions (ADR-021 health model). Single writer of
 * connections.health_status: reads the current value, applies the transition,
 * audits the change, and always stamps health_checked_at.
 * 'failed' is terminal for revoked permissions — it can only be left by an
 * explicit reconnect (health set back to 'pending' on a fresh OAuth grant).
 */
import type pg from "pg";

import { withWorkspace } from "../tenancy.js";
import type { ConnectionHealth } from "./connections.js";

export interface HealthTransition {
  changed: boolean;
  from: ConnectionHealth;
  to: ConnectionHealth;
}

export async function updateConnectionHealth(
  pool: pg.Pool,
  workspaceId: string,
  connectionId: string,
  next: ConnectionHealth,
  reason: string,
): Promise<HealthTransition> {
  return withWorkspace(pool, workspaceId, async (tx) => {
    const current = await tx.query(`SELECT health_status FROM connections WHERE id = $1`, [connectionId]);
    if (!current.rowCount) throw new Error(`connection not found: ${connectionId}`);
    const from = (current.rows[0] as { health_status: ConnectionHealth }).health_status;

    // Terminal 'failed' only clears via explicit reconnect (target 'pending').
    const effective: ConnectionHealth = from === "failed" && next !== "pending" ? "failed" : next;

    await tx.query(`UPDATE connections SET health_status = $2, health_checked_at = now() WHERE id = $1`, [connectionId, effective]);
    const changed = effective !== from;
    if (changed) {
      await tx.query(
        `INSERT INTO audit_log (workspace_id, actor, event, details) VALUES ($1, 'health-monitor', 'connection.health_changed', $2::jsonb)`,
        [workspaceId, JSON.stringify({ connectionId, from, to: effective, reason })],
      );
    }
    return { changed, from, to: effective };
  });
}
