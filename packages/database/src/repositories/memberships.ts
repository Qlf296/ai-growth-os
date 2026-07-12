/**
 * Memberships — workspace-scoped by construction: repositories never accept a
 * workspace_id parameter; scope comes from the surrounding withWorkspace
 * transaction, and RLS backs it up (S3 §11 layers 1+2).
 */
import type { Tx } from "../tenancy.js";

export type MembershipRole = "owner" | "admin" | "member";

export interface Membership {
  workspaceId: string;
  userId: string;
  role: MembershipRole;
  createdAt: Date;
}

export class MembershipRepository {
  async add(tx: Tx, input: { userId: string; role: MembershipRole }): Promise<void> {
    await tx.query(
      `INSERT INTO memberships (workspace_id, user_id, role)
       VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, $2)`,
      [input.userId, input.role],
    );
  }

  async list(tx: Tx): Promise<Membership[]> {
    const r = await tx.query(
      `SELECT workspace_id, user_id, role, created_at FROM memberships ORDER BY created_at`,
    );
    return r.rows.map((row: Record<string, unknown>) => ({
      workspaceId: row.workspace_id as string,
      userId: row.user_id as string,
      role: row.role as MembershipRole,
      createdAt: row.created_at as Date,
    }));
  }

  async remove(tx: Tx, userId: string): Promise<boolean> {
    const r = await tx.query(`DELETE FROM memberships WHERE user_id = $1`, [userId]);
    return (r.rowCount ?? 0) > 0;
  }
}
