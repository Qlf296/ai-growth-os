/**
 * Connections — workspace-owned, authorized_by mandatory (ADR-019).
 * Capabilities are data (ADR-007): pipelines consult capabilities, never
 * provider names. Tokens NEVER pass through here (I8 — vault path only).
 */
import type { Tx } from "../tenancy.js";

export interface Connection {
  id: string;
  provider: string;
  status: "active" | "expired" | "revoked" | "error";
  scopes: string[];
  capabilities: Record<string, unknown>;
  authorizedBy: string;
  createdAt: Date;
}

export class ConnectionRepository {
  async create(
    tx: Tx,
    input: {
      provider: string;
      scopes: string[];
      capabilities: Record<string, unknown>;
      authorizedBy: string;
    },
  ): Promise<string> {
    const r = await tx.query(
      `INSERT INTO connections (workspace_id, provider, status, scopes, capabilities, authorized_by)
       VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, 'active', $2, $3::jsonb, $4)
       RETURNING id`,
      [input.provider, input.scopes, JSON.stringify(input.capabilities), input.authorizedBy],
    );
    return r.rows[0].id as string;
  }

  async list(tx: Tx): Promise<Connection[]> {
    const r = await tx.query(
      `SELECT id, provider, status, scopes, capabilities, authorized_by, created_at
       FROM connections ORDER BY created_at`,
    );
    return r.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      provider: row.provider as string,
      status: row.status as Connection["status"],
      scopes: row.scopes as string[],
      capabilities: row.capabilities as Record<string, unknown>,
      authorizedBy: row.authorized_by as string,
      createdAt: row.created_at as Date,
    }));
  }

  async setStatus(tx: Tx, id: string, status: Connection["status"]): Promise<boolean> {
    const r = await tx.query(`UPDATE connections SET status = $2 WHERE id = $1`, [id, status]);
    return (r.rowCount ?? 0) > 0;
  }
}
