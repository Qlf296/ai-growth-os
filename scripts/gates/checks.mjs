/**
 * CI merge gates (ARCHITECTURE_TESTS Category D) — pure functions + CLI.
 * Provider-agnostic: any CI calls `npm run gates`; GitHub Actions is a thin
 * wrapper. A red gate exits non-zero → merge blocked (branch protection).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** ADR-043: every migration ships NOTES.md (Rollback+Backfill); DROPs need '-- contract:'. */
export function checkMigrations(migrationsDir) {
  const errors = [];
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  if (dirs.length === 0) errors.push("no migrations found");
  for (const dir of dirs) {
    const base = join(migrationsDir, dir);
    const sqlPath = join(base, "migration.sql");
    if (!existsSync(sqlPath)) errors.push(`${dir}: missing migration.sql`);
    else {
      const sql = readFileSync(sqlPath, "utf8");
      for (const line of sql.split("\n")) {
        if (/DROP\s+(TABLE|COLUMN)/i.test(line) && !/--\s*contract:/i.test(line)) {
          errors.push(`${dir}: bare DROP without '-- contract:' (expand-contract, ADR-043): ${line.trim()}`);
        }
      }
    }
    const notesPath = join(base, "NOTES.md");
    if (!existsSync(notesPath)) {
      errors.push(`${dir}: missing NOTES.md (ADR-043 rollback+backfill declarations)`);
      continue;
    }
    const notes = readFileSync(notesPath, "utf8");
    if (!/## Rollback/.test(notes)) errors.push(`${dir}: NOTES.md lacks '## Rollback'`);
    if (!/## Backfill/.test(notes)) errors.push(`${dir}: NOTES.md lacks '## Backfill'`);
  }
  return errors;
}

/** AT-unscoped: dangerouslyUnscoped call sites are enumerated; new ones need an allowlist entry + review. */
export function checkUnscoped(rootDir, allowlist) {
  const errors = [];
  const found = [];
  const scan = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", "dist", ".git", "test"].includes(entry.name)) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) scan(p);
      else if (entry.name.endsWith(".ts")) {
        const text = readFileSync(p, "utf8");
        const lines = text.split("\n");
        lines.forEach((line, i) => {
          if (line.includes("dangerouslyUnscoped(") && !/export (async )?function dangerouslyUnscoped/.test(line)) {
            found.push(`${p.replace(rootDir + "/", "")}:${i + 1}`);
          }
        });
      }
    }
  };
  for (const top of ["packages", "apps"]) scan(join(rootDir, top));
  for (const site of found) {
    const file = site.split(":")[0];
    if (!allowlist.includes(file)) {
      errors.push(`unallowlisted dangerouslyUnscoped call site: ${site} — add to .unscoped-allowlist.json via review (S3 §11)`);
    }
  }
  for (const allowed of allowlist) {
    if (!found.some((site) => site.startsWith(allowed + ":"))) {
      errors.push(`stale allowlist entry (no call site found): ${allowed}`);
    }
  }
  return errors;
}

/**
 * AT-14 (CI half): a diff that touches a decision-affecting config definition
 * (its defaultValue or a `decisionAffecting: true` block) requires a linked
 * shadow-eval artifact (docs/shadow-evals/*.md added in the same diff).
 * Runtime half already enforced by ConfigRegistry (ADR-045).
 */
export function checkDecisionConfig(diffText) {
  const errors = [];
  const files = new Map(); // file -> added/removed lines
  let current = null;
  for (const line of diffText.split("\n")) {
    const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (m) {
      current = m[2];
      files.set(current, []);
      continue;
    }
    if (current && /^[+-][^+-]/.test(line)) files.get(current).push(line);
  }

  const touchesDecisionDefinition = [...files.entries()].some(
    ([file, lines]) =>
      file.endsWith(".ts") &&
      !file.includes("/test/") &&
      lines.some((l) => /decisionAffecting:\s*true/.test(l) || /defaultValue:/.test(l)),
  );
  const addsShadowEval = [...files.keys()].some((f) => /^docs\/shadow-evals\/.+\.md$/.test(f));

  if (touchesDecisionDefinition && !addsShadowEval) {
    errors.push(
      "decision-affecting config definition changed without a linked shadow-eval artifact (docs/shadow-evals/*.md) — AT-14 / ADR-045",
    );
  }
  return errors;
}
