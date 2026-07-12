/**
 * Test harness: boots a REAL PostgreSQL (embedded binaries), applies the
 * migrations exactly as production would, creates the runtime roles, and
 * hands out pools per role.
 *
 * Note on Supabase pooler fidelity: transaction-mode pooling means one
 * physical connection is reused by many logical clients, and only
 * transaction-scoped state (SET LOCAL) is safe. The pooler tests reuse a
 * single physical connection across sequential transactions — the exact
 * hazard surface of the pooler. A live-Supabase run of this suite is a
 * Phase 0 exit item (BUILD_RULES step 10 wires it into CI).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

import { applyMigrations } from "../src/migrate.js";

export interface Harness {
  /** superuser pool (migrator) */
  admin: pg.Pool;
  /** RLS-constrained application role (I9) */
  app: pg.Pool;
  /** the only role that can touch provider_tokens (I8) */
  vault: pg.Pool;
  stop(): Promise<void>;
  connectionString(user: string, password: string): string;
}

let counter = 0;

export async function startHarness(): Promise<Harness> {
  const port = 56000 + Math.floor(Math.random() * 2000) + counter++;
  const server = new EmbeddedPostgres({
    databaseDir: mkdtempSync(join(tmpdir(), "aigos-pg-")),
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });
  await server.initialise();
  await server.start();

  const url = (user: string, password: string) =>
    `postgresql://${user}:${password}@127.0.0.1:${port}/postgres`;

  const admin = new pg.Pool({ connectionString: url("postgres", "postgres") });
  await applyMigrations(admin);

  const app = new pg.Pool({ connectionString: url("aigos_app", "app_pw_test"), max: 2 });
  const vault = new pg.Pool({ connectionString: url("aigos_vault", "vault_pw_test"), max: 1 });

  return {
    admin,
    app,
    vault,
    connectionString: url,
    async stop() {
      await app.end().catch(() => {});
      await vault.end().catch(() => {});
      await admin.end().catch(() => {});
      await server.stop();
    },
  };
}

/** Provision a workspace + owner directly as admin (bootstrap path). */
export async function seedWorkspace(
  admin: pg.Pool,
  id: string,
  name: string,
): Promise<void> {
  await admin.query(
    `INSERT INTO plans (id, limits) VALUES ('free', '{"daily_actions":5}') ON CONFLICT DO NOTHING`,
  );
  await admin.query(
    `INSERT INTO workspaces (id, name, plan_id) VALUES ($1, $2, 'free')`,
    [id, name],
  );
}
