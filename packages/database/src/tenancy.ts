/**
 * Workspace scoping — S3 §11 layer 1 over layer 2 (RLS).
 *
 * Every tenant access happens inside `withWorkspace`, which opens a
 * transaction and applies `SET LOCAL app.workspace_id` (via the parameterized
 * form `set_config(..., true)` — same semantics, injection-safe).
 * NEVER SET SESSION: session state leaks across pooled connections
 * (Supabase transaction-mode pooling reuses physical connections).
 */
import type pg from "pg";

export interface Tx {
  query: pg.ClientBase["query"];
}

async function runScoped<T>(
  client: pg.ClientBase,
  workspaceId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    // SET LOCAL — transaction-scoped, pooler-safe (BUILD_RULES step 3).
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
    const result = await fn({ query: client.query.bind(client) });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

/** Run `fn` in a workspace-scoped transaction on a pooled connection. */
export async function withWorkspace<T>(
  pool: pg.Pool,
  workspaceId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await runScoped(client, workspaceId, fn);
  } finally {
    client.release();
  }
}

/** User-scoped READ transaction (S6 §3): SET LOCAL app.user_id — same pooler-safe discipline. */
export async function withUser<T>(
  pool: pg.Pool,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn({ query: client.query.bind(client) });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Same, on an already-checked-out client (used by the pooler-safety tests). */
export async function withWorkspaceOnClient<T>(
  client: pg.ClientBase,
  workspaceId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return runScoped(client, workspaceId, fn);
}

/**
 * The ONLY unscoped entry point (S3 §11: explicitly named, lint-flagged,
 * code-review-gated — AT-unscoped enumerates usages). Legitimate callers:
 * workspace provisioning, GDPR purge jobs, ops tooling. Everything else
 * goes through withWorkspace.
 */
export async function dangerouslyUnscoped<T>(
  pool: pg.Pool,
  reason: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!reason.trim()) {
    throw new Error("dangerouslyUnscoped requires a written reason (audited)");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn({ query: client.query.bind(client) });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
