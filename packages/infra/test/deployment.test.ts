/**
 * STEP 10.7 — deployment validation: environment + secret verification (reusing
 * the STEP 10.1 schema), migration presence, rollback declarations (ADR-043)
 * and sequential ordering, aggregated into a deterministic deployment report.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  renderDeploymentReport,
  scanMigrations,
  validateDeployment,
  type MigrationDescriptor,
  type VarSpec,
} from "../src/index.js";

const schema: VarSpec[] = [
  { key: "DATABASE_URL", kind: "url", required: true, secret: true, description: "db" },
  { key: "VAULT_ENCRYPTION_KEY", kind: "string", required: true, secret: true, minLength: 8, description: "vault" },
  { key: "APP_BASE_URL", kind: "url", required: true, description: "app" },
];

const goodEnv = { DATABASE_URL: "postgres://h/db", VAULT_ENCRYPTION_KEY: "longenough", APP_BASE_URL: "https://a.example" };
const goodMigrations: MigrationDescriptor[] = [
  { name: "0001_init", hasSql: true, rollbackDeclared: true },
  { name: "0002_more", hasSql: true, rollbackDeclared: true },
];

describe("validateDeployment", () => {
  it("passes when env, secrets and migrations are all valid", () => {
    const r = validateDeployment({ env: goodEnv, schema, migrations: goodMigrations });
    expect(r.ok).toBe(true);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
  });

  it("fails environment + secret checks on a missing secret", () => {
    const r = validateDeployment({ env: { ...goodEnv, VAULT_ENCRYPTION_KEY: "" }, schema, migrations: goodMigrations });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === "environment")?.ok).toBe(false);
    expect(r.checks.find((c) => c.name === "secrets")?.ok).toBe(false);
  });

  it("fails rollback validation when a migration declares no rollback (ADR-043)", () => {
    const r = validateDeployment({
      env: goodEnv,
      schema,
      migrations: [...goodMigrations, { name: "0003_bad", hasSql: true, rollbackDeclared: false }],
    });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === "migrations_rollback")?.ok).toBe(false);
    expect(r.errors.some((e) => /0003_bad/.test(e))).toBe(true);
  });

  it("fails migration presence when SQL is missing", () => {
    const r = validateDeployment({
      env: goodEnv,
      schema,
      migrations: [{ name: "0001_init", hasSql: false, rollbackDeclared: true }],
    });
    expect(r.checks.find((c) => c.name === "migrations_present")?.ok).toBe(false);
  });

  it("fails ordering when migrations are unsorted or duplicated", () => {
    const r = validateDeployment({
      env: goodEnv,
      schema,
      migrations: [
        { name: "0002_x", hasSql: true, rollbackDeclared: true },
        { name: "0001_y", hasSql: true, rollbackDeclared: true },
      ],
    });
    expect(r.checks.find((c) => c.name === "migrations_sequential")?.ok).toBe(false);
  });

  it("renders a deterministic report", () => {
    const text = renderDeploymentReport(validateDeployment({ env: goodEnv, schema, migrations: goodMigrations }));
    expect(text).toContain("Deployment: READY");
    expect(text).toContain("environment");
  });
});

describe("scanMigrations", () => {
  const root = mkdtempSync(join(tmpdir(), "mig-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const write = (name: string, sql: boolean, rollbackBody: string | null) => {
    const dir = join(root, name);
    mkdirSync(dir);
    if (sql) writeFileSync(join(dir, "migration.sql"), "CREATE TABLE t();");
    if (rollbackBody !== null) writeFileSync(join(dir, "NOTES.md"), `# n\n\n## Rollback\n${rollbackBody}\n\n## Backfill\nNone.\n`);
  };

  it("reads sql + non-empty rollback declarations, sorted by name", () => {
    write("0001_ok", true, "DROP TABLE t; -- contract:");
    write("0002_norollback", true, ""); // empty rollback body
    write("0003_nosql", false, "DROP TABLE u;");
    const descriptors = scanMigrations(root);
    expect(descriptors.map((d) => d.name)).toEqual(["0001_ok", "0002_norollback", "0003_nosql"]);
    expect(descriptors[0]).toEqual({ name: "0001_ok", hasSql: true, rollbackDeclared: true });
    expect(descriptors[1]?.rollbackDeclared).toBe(false);
    expect(descriptors[2]?.hasSql).toBe(false);
  });
})
