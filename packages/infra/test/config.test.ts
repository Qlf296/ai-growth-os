/** STEP 10.1 — production config validation: missing/invalid env, startup guard, deterministic, secret-safe. */
import { describe, expect, it } from "vitest";

import { PRODUCTION_ENV, assertValidEnv, renderConfigReport, validateEnv } from "../src/index.js";

const validEnv = (): Record<string, string> => ({
  DATABASE_URL: "postgresql://u:p@host:5432/db",
  VAULT_ENCRYPTION_KEY: "a".repeat(64),
  VAULT_KEY_ID: "kms-key-1",
  SESSION_HMAC_KEY: "s".repeat(40),
  GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "gocspx-secret",
  GOOGLE_REDIRECT_URI: "https://app.example/connections/google/callback",
  REDIS_URL: "redis://host:6379",
  APP_BASE_URL: "https://app.example",
});

describe("validateEnv", () => {
  it("passes on a complete valid environment", () => {
    const r = validateEnv(validEnv());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("reports every missing required variable", () => {
    const r = validateEnv({});
    expect(r.ok).toBe(false);
    const required = PRODUCTION_ENV.filter((s) => s.required).length;
    expect(r.errors.filter((e) => /required/.test(e))).toHaveLength(required);
  });

  it("rejects invalid values (bad URL, non-integer PORT, short secret)", () => {
    const env = { ...validEnv(), DATABASE_URL: "not-a-url", PORT: "abc", VAULT_ENCRYPTION_KEY: "short" };
    const r = validateEnv(env);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /DATABASE_URL/.test(e))).toBe(true);
    expect(r.errors.some((e) => /PORT/.test(e))).toBe(true);
    expect(r.errors.some((e) => /VAULT_ENCRYPTION_KEY/.test(e))).toBe(true);
  });

  it("is deterministic: same env → identical report", () => {
    expect(validateEnv(validEnv())).toEqual(validateEnv(validEnv()));
  });

  it("the report never contains secret values (I8)", () => {
    const env = validEnv();
    const text = renderConfigReport(validateEnv(env));
    for (const secret of [env.VAULT_ENCRYPTION_KEY, env.GOOGLE_CLIENT_SECRET, env.SESSION_HMAC_KEY]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("VAULT_ENCRYPTION_KEY (secret)");
  });
});

describe("assertValidEnv (startup guard)", () => {
  it("throws with the errors when invalid; passes silently when valid", () => {
    expect(() => assertValidEnv({})).toThrow(/Invalid production configuration/);
    expect(() => assertValidEnv(validEnv())).not.toThrow();
  });
});
