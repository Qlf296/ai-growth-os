/**
 * Deployment validation (STEP 10.7). A pre-deploy verifier that aggregates
 * environment + secret verification (STEP 10.1 schema), migration presence,
 * rollback declarations (ADR-043 expand-contract) and sequential ordering into
 * one deterministic deployment report. This is the deploy-time complement to
 * the build-time CI migration gate: it additionally requires each migration's
 * Rollback section to carry actual content, not just a heading.
 */
import { PRODUCTION_ENV, validateEnv, type VarSpec } from "./config/env.js";

export interface MigrationDescriptor {
  readonly name: string;
  readonly hasSql: boolean;
  /** NOTES.md declares a Rollback section with non-empty content. */
  readonly rollbackDeclared: boolean;
}

export interface DeploymentCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface DeploymentReport {
  readonly ok: boolean;
  readonly checks: DeploymentCheck[];
  readonly errors: string[];
}

export interface DeploymentInputs {
  readonly env: Record<string, string | undefined>;
  readonly schema?: readonly VarSpec[];
  readonly migrations: readonly MigrationDescriptor[];
}

export function validateDeployment(inputs: DeploymentInputs): DeploymentReport {
  const checks: DeploymentCheck[] = [];
  const errors: string[] = [];

  const env = validateEnv(inputs.env, inputs.schema ?? PRODUCTION_ENV);
  checks.push({ name: "environment", ok: env.ok, ...(env.ok ? {} : { detail: `${env.errors.length} invalid variable(s)` }) });
  if (!env.ok) errors.push(...env.errors);

  const secretVars = env.vars.filter((v) => v.secret);
  const unverifiedSecrets = secretVars.filter((v) => !(v.valid && v.present)).map((v) => v.key);
  checks.push({ name: "secrets", ok: unverifiedSecrets.length === 0, ...(unverifiedSecrets.length ? { detail: unverifiedSecrets.join(", ") } : {}) });
  errors.push(...unverifiedSecrets.map((k) => `secret ${k} is unverified`));

  const missingSql = inputs.migrations.filter((m) => !m.hasSql).map((m) => m.name);
  checks.push({ name: "migrations_present", ok: missingSql.length === 0, ...(missingSql.length ? { detail: missingSql.join(", ") } : {}) });
  errors.push(...missingSql.map((n) => `migration ${n} is missing migration.sql`));

  const noRollback = inputs.migrations.filter((m) => !m.rollbackDeclared).map((m) => m.name);
  checks.push({ name: "migrations_rollback", ok: noRollback.length === 0, ...(noRollback.length ? { detail: noRollback.join(", ") } : {}) });
  errors.push(...noRollback.map((n) => `migration ${n} declares no rollback (ADR-043)`));

  const names = inputs.migrations.map((m) => m.name);
  const ordered = JSON.stringify(names) === JSON.stringify([...names].sort()) && new Set(names).size === names.length;
  checks.push({ name: "migrations_sequential", ok: ordered });
  if (!ordered) errors.push("migrations are not uniquely and sequentially ordered");

  return { ok: checks.every((c) => c.ok), checks, errors: errors.sort() };
}

export function renderDeploymentReport(report: DeploymentReport): string {
  const lines = report.checks.map((c) => `${c.ok ? "ok " : "ERR"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  return [`Deployment: ${report.ok ? "READY" : "BLOCKED"}`, ...lines].join("\n");
}
