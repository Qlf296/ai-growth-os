/**
 * Production configuration & environment validation (STEP 10.1). A declarative
 * schema of required/optional variables with typed parsing and secret marking.
 * Validation is deterministic and pure; startup calls it once and fails fast
 * with a redacted report (secrets never printed — I8 discipline).
 */
export type VarKind = "string" | "number" | "url" | "boolean";

export interface VarSpec {
  readonly key: string;
  readonly kind: VarKind;
  readonly required: boolean;
  /** Secret values are redacted in every report/log (I8). */
  readonly secret?: boolean;
  /** Minimum length for secrets (e.g. 32 hex bytes for the vault key). */
  readonly minLength?: number;
  readonly description: string;
}

export interface ValidatedVar {
  readonly key: string;
  readonly present: boolean;
  readonly valid: boolean;
  readonly secret: boolean;
  readonly error?: string;
}

export interface ConfigReport {
  readonly ok: boolean;
  readonly vars: ValidatedVar[];
  readonly errors: string[];
}

/** The production environment contract for AI Growth OS. */
export const PRODUCTION_ENV: readonly VarSpec[] = [
  { key: "DATABASE_URL", kind: "url", required: true, secret: true, description: "Postgres (Supabase) connection string" },
  { key: "VAULT_ENCRYPTION_KEY", kind: "string", required: true, secret: true, minLength: 64, description: "AES-256 vault key (32 bytes hex, I8)" },
  { key: "VAULT_KEY_ID", kind: "string", required: true, description: "Vault key id for rotation" },
  { key: "SESSION_HMAC_KEY", kind: "string", required: true, secret: true, minLength: 32, description: "OAuth state / session HMAC key" },
  { key: "GOOGLE_CLIENT_ID", kind: "string", required: true, description: "Google OAuth client id" },
  { key: "GOOGLE_CLIENT_SECRET", kind: "string", required: true, secret: true, description: "Google OAuth client secret" },
  { key: "GOOGLE_REDIRECT_URI", kind: "url", required: true, description: "OAuth callback URL" },
  { key: "REDIS_URL", kind: "url", required: true, description: "Redis (queue/cache) connection string" },
  { key: "APP_BASE_URL", kind: "url", required: true, description: "Public app base URL" },
  { key: "PORT", kind: "number", required: false, description: "HTTP port (default 3000)" },
];

function validateOne(spec: VarSpec, raw: string | undefined): ValidatedVar {
  const base = { key: spec.key, secret: spec.secret ?? false } as const;
  if (raw === undefined || raw === "") {
    return spec.required
      ? { ...base, present: false, valid: false, error: `${spec.key} is required` }
      : { ...base, present: false, valid: true };
  }
  let error: string | undefined;
  switch (spec.kind) {
    case "number": if (!/^-?\d+$/.test(raw)) error = `${spec.key} must be an integer`; break;
    case "url": try { new URL(raw); } catch { error = `${spec.key} must be a valid URL`; } break;
    case "boolean": if (!/^(true|false)$/.test(raw)) error = `${spec.key} must be true|false`; break;
    case "string": break;
  }
  if (!error && spec.minLength !== undefined && raw.length < spec.minLength) {
    error = `${spec.key} must be at least ${spec.minLength} characters`;
  }
  return error ? { ...base, present: true, valid: false, error } : { ...base, present: true, valid: true };
}

/** Deterministic: same env → same report. Secrets are never included, only validity. */
export function validateEnv(env: Record<string, string | undefined>, schema: readonly VarSpec[] = PRODUCTION_ENV): ConfigReport {
  const vars = schema.map((s) => validateOne(s, env[s.key]));
  const errors = vars.filter((v) => !v.valid).map((v) => v.error!).sort();
  return { ok: errors.length === 0, vars, errors };
}

/** Human-readable, secret-safe report (redacts everything; prints only key + status). */
export function renderConfigReport(report: ConfigReport): string {
  const lines = report.vars.map((v) => `${v.valid ? "ok " : "ERR"} ${v.key}${v.secret ? " (secret)" : ""}${v.error ? ` — ${v.error}` : v.present ? "" : " — not set (optional)"}`);
  return [`Configuration: ${report.ok ? "OK" : "INVALID"}`, ...lines].join("\n");
}

/** Startup guard: throw with the report if invalid (fail fast, no secret leakage). */
export function assertValidEnv(env: Record<string, string | undefined>, schema: readonly VarSpec[] = PRODUCTION_ENV): void {
  const report = validateEnv(env, schema);
  if (!report.ok) throw new Error(`Invalid production configuration:\n${report.errors.join("\n")}`);
}
