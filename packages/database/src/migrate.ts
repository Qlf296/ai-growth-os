/**
 * Migration applier (ADR-043). Prisma-standard layout
 * (`prisma/migrations/<timestamp>_<name>/migration.sql`) so production can use
 * `prisma migrate deploy`; this applier runs the SAME SQL files for embedded
 * test databases and local dev. One source of truth, two runners.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, "..", "prisma", "migrations");

export async function applyMigrations(pool: pg.Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const applied: string[] = [];
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const name of names) {
    const done = await pool.query("SELECT 1 FROM _migrations WHERE name = $1", [name]);
    if (done.rowCount) continue;
    const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
      applied.push(name);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error(`Migration ${name} failed: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}
