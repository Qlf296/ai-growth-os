/**
 * ADR-043 — schema evolution (expand-contract). Every migration must declare
 * its rollback and backfill strategy in a NOTES.md. The CI merge gate
 * (BUILD_RULES step 10) will reject migration PRs without them; this test is
 * the same rule enforced locally from day 1.
 * Also: dangerouslyUnscoped is the ONLY unscoped API and it is enumerated
 * (S3 §11 layer 1, AT-unscoped).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const migrationsDir = join(pkgRoot, "prisma", "migrations");

describe("ADR-043 — migration discipline", () => {
  it("the migrations directory exists and is non-empty", () => {
    expect(existsSync(migrationsDir)).toBe(true);
    expect(readdirSync(migrationsDir).filter((d) => !d.startsWith(".")).length).toBeGreaterThan(0);
  });

  it("every migration ships migration.sql + NOTES.md with Rollback and Backfill sections", () => {
    for (const dir of readdirSync(migrationsDir).filter((d) => !d.startsWith("."))) {
      const base = join(migrationsDir, dir);
      expect(existsSync(join(base, "migration.sql")), `${dir}/migration.sql`).toBe(true);
      const notesPath = join(base, "NOTES.md");
      expect(existsSync(notesPath), `${dir}/NOTES.md`).toBe(true);
      const notes = readFileSync(notesPath, "utf8");
      expect(notes, `${dir}: Rollback section`).toMatch(/## Rollback/);
      expect(notes, `${dir}: Backfill section`).toMatch(/## Backfill/);
    }
  });

  it("migrations are expand-contract: no bare DROP TABLE/COLUMN without a '-- contract:' marker", () => {
    for (const dir of readdirSync(migrationsDir).filter((d) => !d.startsWith("."))) {
      const sql = readFileSync(join(migrationsDir, dir, "migration.sql"), "utf8");
      for (const line of sql.split("\n")) {
        if (/DROP\s+(TABLE|COLUMN)/i.test(line) && !/--\s*contract:/i.test(line)) {
          throw new Error(`${dir}: bare DROP without '-- contract:' justification: ${line.trim()}`);
        }
      }
    }
  });
});

describe("S3 §11 — the unscoped escape hatch is explicit and enumerated", () => {
  it("src exposes exactly one dangerouslyUnscoped entry point", () => {
    const srcDir = join(pkgRoot, "src");
    let count = 0;
    const scan = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) scan(join(dir, entry.name));
        else if (entry.name.endsWith(".ts")) {
          const text = readFileSync(join(dir, entry.name), "utf8");
          count += (text.match(/export (async )?function dangerouslyUnscoped/g) ?? []).length;
        }
      }
    };
    scan(srcDir);
    expect(count).toBe(1);
  });
});
