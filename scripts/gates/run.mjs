#!/usr/bin/env node
/** Gate runner CLI: `node scripts/gates/run.mjs [baseRef]`. Non-zero exit = merge blocked. */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkDecisionConfig, checkMigrations, checkUnscoped } from "./checks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const baseRef = process.argv[2] ?? "";
let failed = false;

const report = (gate, errors) => {
  if (errors.length) {
    failed = true;
    console.error(`✗ ${gate}`);
    for (const e of errors) console.error(`    ${e}`);
  } else {
    console.log(`✓ ${gate}`);
  }
};

report("gate:migrations (ADR-043)", checkMigrations(join(root, "packages/database/prisma/migrations")));

const allowlist = JSON.parse(readFileSync(join(root, ".unscoped-allowlist.json"), "utf8"));
report("gate:unscoped (S3 §11)", checkUnscoped(root, allowlist));

if (baseRef) {
  const diff = execSync(`git diff ${baseRef}...HEAD`, { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString();
  report("gate:decision-config (AT-14)", checkDecisionConfig(diff));
} else {
  console.log("– gate:decision-config (AT-14): skipped (no base ref — full run happens on PRs)");
}

process.exit(failed ? 1 : 0);
