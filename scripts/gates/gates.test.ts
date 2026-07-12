/** Gates are code: tested like everything else (Category D, ARCHITECTURE_TESTS). */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain mjs module
import { checkDecisionConfig, checkMigrations, checkUnscoped } from "./checks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("gate:migrations (ADR-043)", () => {
  it("passes on the real migrations directory", () => {
    expect(checkMigrations(join(root, "packages/database/prisma/migrations"))).toEqual([]);
  });

  it("fails a migration without NOTES.md or with a bare DROP", () => {
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    mkdirSync(join(dir, "001_bad"));
    writeFileSync(join(dir, "001_bad", "migration.sql"), "DROP TABLE users;\n");
    const errors = checkMigrations(dir);
    expect(errors.some((e: string) => e.includes("missing NOTES.md"))).toBe(true);
    expect(errors.some((e: string) => e.includes("bare DROP"))).toBe(true);
  });
});

describe("gate:unscoped (S3 §11)", () => {
  it("passes with the committed allowlist (single source of truth)", () => {
    const allowlist = JSON.parse(readFileSync(join(root, ".unscoped-allowlist.json"), "utf8"));
    expect(checkUnscoped(root, allowlist)).toEqual([]);
  });

  it("flags a missing allowlist entry AND a stale one", () => {
    const errors = checkUnscoped(root, ["packages/nope.ts"]);
    expect(errors.some((e: string) => e.includes("unallowlisted"))).toBe(true);
    expect(errors.some((e: string) => e.includes("stale allowlist"))).toBe(true);
  });
});

describe("gate:decision-config (AT-14)", () => {
  const diffTouchingWeight = `diff --git a/packages/recommendation/src/keys.ts b/packages/recommendation/src/keys.ts
--- a/packages/recommendation/src/keys.ts
+++ b/packages/recommendation/src/keys.ts
-  defaultValue: 0.3,
+  defaultValue: 0.35,
`;

  it("blocks a decision-affecting default change without a shadow-eval artifact", () => {
    expect(checkDecisionConfig(diffTouchingWeight)).toHaveLength(1);
  });

  it("passes when the same diff adds a shadow-eval artifact", () => {
    const withArtifact =
      diffTouchingWeight +
      `diff --git a/docs/shadow-evals/recommendation.w_goal-20260712.md b/docs/shadow-evals/recommendation.w_goal-20260712.md
+++ b/docs/shadow-evals/recommendation.w_goal-20260712.md
+replay window, metrics, ratification
`;
    expect(checkDecisionConfig(withArtifact)).toEqual([]);
  });

  it("ignores test files and non-config diffs", () => {
    const testOnly = `diff --git a/packages/x/test/y.test.ts b/packages/x/test/y.test.ts
+  defaultValue: 0.9,
`;
    expect(checkDecisionConfig(testOnly)).toEqual([]);
  });
});
