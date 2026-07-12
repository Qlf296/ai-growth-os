/**
 * Minimal, dependency-free validators for config values.
 * Deliberately small: config values are scalars or flat records (ADR-046);
 * anything richer belongs in the database schema, not the registry.
 */
import type { ConfigSchema, SchemaResult } from "./types.js";

const ok: SchemaResult = { ok: true };
const fail = (message: string): SchemaResult => ({ ok: false, message });

export function num(opts: { min?: number; max?: number }): ConfigSchema<number> {
  const { min, max } = opts;
  return {
    describe: `number${min !== undefined ? ` ≥ ${min}` : ""}${max !== undefined ? ` ≤ ${max}` : ""}`,
    validate(value) {
      if (typeof value !== "number" || Number.isNaN(value)) return fail("expected a number");
      if (min !== undefined && value < min) return fail(`must be ≥ ${min}`);
      if (max !== undefined && value > max) return fail(`must be ≤ ${max}`);
      return ok;
    },
  };
}

export function int(opts: { min?: number; max?: number }): ConfigSchema<number> {
  const base = num(opts);
  return {
    describe: `integer (${base.describe})`,
    validate(value) {
      if (typeof value !== "number" || !Number.isInteger(value)) return fail("expected an integer");
      return base.validate(value);
    },
  };
}

export function bool(): ConfigSchema<boolean> {
  return {
    describe: "boolean",
    validate: (value) => (typeof value === "boolean" ? ok : fail("expected a boolean")),
  };
}

export function str(opts: { pattern?: RegExp } = {}): ConfigSchema<string> {
  return {
    describe: `string${opts.pattern ? ` matching ${opts.pattern}` : ""}`,
    validate(value) {
      if (typeof value !== "string") return fail("expected a string");
      if (opts.pattern && !opts.pattern.test(value)) return fail(`must match ${opts.pattern}`);
      return ok;
    },
  };
}

export function oneOf<const T extends readonly (string | number)[]>(
  allowed: T,
): ConfigSchema<T[number]> {
  return {
    describe: `one of [${allowed.join(", ")}]`,
    validate: (value) =>
      allowed.includes(value as T[number]) ? ok : fail(`must be one of [${allowed.join(", ")}]`),
  };
}
