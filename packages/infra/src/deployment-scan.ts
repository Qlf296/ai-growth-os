/**
 * Filesystem reader for deployment validation (STEP 10.7). Extracts migration
 * descriptors from a Prisma-style migrations directory so `validateDeployment`
 * can verify rollback declarations against the real tree at deploy time.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { MigrationDescriptor } from "./deployment.js";

export function scanMigrations(dir: string): MigrationDescriptor[] {
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort()
    .map((name) => {
      const base = join(dir, name);
      const notesPath = join(base, "NOTES.md");
      let rollbackDeclared = false;
      if (existsSync(notesPath)) {
        const match = readFileSync(notesPath, "utf8").match(/## Rollback[^\n]*\n([\s\S]*?)(?:\n## |\s*$)/);
        rollbackDeclared = match !== null && match[1]!.trim().length > 0;
      }
      return { name, hasSql: existsSync(join(base, "migration.sql")), rollbackDeclared };
    });
}
