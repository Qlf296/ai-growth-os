/**
 * First-login provisioning (S6 §3 signup flow): get-or-create user by verified
 * email; if the user owns no workspace, create one (plan 'free') + owner
 * membership. RLS-compatible without any unscoped query: the new workspace id
 * is generated first, then inserted inside its own scope.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";

import { withUser, withWorkspace } from "./tenancy.js";

export interface ProvisionedIdentity {
  readonly userId: string;
  readonly workspaces: { id: string; name: string; role: string }[];
}

/** A user's own workspaces (user-scoped read, migration 0005). */
export async function listUserWorkspaces(
  pool: pg.Pool,
  userId: string,
): Promise<ProvisionedIdentity["workspaces"]> {
  const r = await withUser(pool, userId, (tx) =>
    tx.query(
      `SELECT m.workspace_id AS id, w.name, m.role
       FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = $1`,
      [userId],
    ),
  );
  return r.rows as ProvisionedIdentity["workspaces"];
}

export async function provisionOnSignIn(pool: pg.Pool, email: string): Promise<ProvisionedIdentity> {
  const user = await pool.query(
    `INSERT INTO users (email, auth_provider) VALUES ($1, 'magic_link')
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [email],
  );
  const userId = (user.rows[0] as { id: string }).id;

  const existing = await listUserWorkspaces(pool, userId);
  if (existing.length) {
    return { userId, workspaces: existing };
  }

  const workspaceId = randomUUID();
  const name = `${email.split("@")[0]}'s workspace`;
  await withWorkspace(pool, workspaceId, async (tx) => {
    await tx.query(`INSERT INTO workspaces (id, name, plan_id) VALUES ($1, $2, 'free')`, [workspaceId, name]);
    await tx.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [workspaceId, userId]);
    await tx.query(`INSERT INTO audit_log (workspace_id, actor, event) VALUES ($1, $2, 'workspace.created')`, [workspaceId, email]);
  });
  return { userId, workspaces: [{ id: workspaceId, name, role: "owner" }] };
}

/** Workspace context check: the session user must be a member (feeds RLS scope per request, S6 §2). */
export async function isMember(pool: pg.Pool, userId: string, workspaceId: string): Promise<boolean> {
  const r = await withWorkspace(pool, workspaceId, (tx) =>
    tx.query(`SELECT 1 FROM memberships WHERE user_id = $1`, [userId]),
  );
  return (r.rowCount ?? 0) > 0;
}
