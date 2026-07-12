/**
 * ConfigRegistry — ADR-046 (config-as-data + stability), gated by ADR-045.
 *
 * Rules enforced here (not by convention):
 *  - unknown keys fail loudly: no silent hardcoded fallbacks anywhere;
 *  - decision-affecting changes require a linked shadow-eval (AT-14);
 *  - frozen keys are immutable at runtime (full Decision Lifecycle required);
 *  - stability moves forward only; experiment→stable needs shadow-eval evidence;
 *  - history is append-only;
 *  - snapshots are immutable and hash-addressed (I1, ADR-044).
 */
import { createHash } from "node:crypto";

import type {
  ChangeContext,
  ConfigChangeRecord,
  ConfigKeyDefinition,
  ConfigSnapshot,
  ConfigStore,
  ReadScope,
  Stability,
} from "./types.js";

const STABILITY_ORDER: Record<Stability, number> = {
  experiment: 0,
  stable: 1,
  frozen: 2,
};

export class ConfigRegistry {
  private readonly definitions = new Map<string, ConfigKeyDefinition>();

  constructor(private readonly store: ConfigStore) {}

  /** Registration happens at boot; definitions are code-reviewed data. */
  define<T>(definition: ConfigKeyDefinition<T>): void {
    if (this.definitions.has(definition.key)) {
      throw new Error(`Config key "${definition.key}" is already defined`);
    }
    const check = definition.schema.validate(definition.defaultValue);
    if (!check.ok) {
      throw new Error(
        `Default value for "${definition.key}" fails its own schema (${definition.schema.describe}): ${check.message}`,
      );
    }
    this.definitions.set(definition.key, definition);
  }

  describe(key: string): ConfigKeyDefinition {
    const def = this.definitions.get(key);
    if (!def) throw new Error(`Config key "${key}" is not defined in the registry`);
    return def;
  }

  /** Precedence: workspace override > global override > default. */
  async get<T = unknown>(key: string, scope: ReadScope = {}): Promise<T> {
    const def = this.describe(key);
    if (scope.workspaceId !== undefined) {
      const ws = await this.store.getOverride(key, scope.workspaceId);
      if (ws !== undefined) return ws as T;
    }
    const global = await this.store.getOverride(key, null);
    if (global !== undefined) return global as T;
    return def.defaultValue as T;
  }

  async setOverride(key: string, value: unknown, context: ChangeContext): Promise<void> {
    const def = this.describe(key);

    if (def.stability === "frozen") {
      throw new Error(
        `Config key "${key}" is frozen — runtime overrides are forbidden; changing it requires the full Decision Lifecycle (DECISION_LIFECYCLE.md)`,
      );
    }
    if (def.decisionAffecting && !context.shadowEvalRef) {
      throw new Error(
        `Config key "${key}" is decision-affecting — a change cannot activate without a linked shadow-eval run (ADR-045 / AT-14)`,
      );
    }
    const check = def.schema.validate(value);
    if (!check.ok) {
      throw new Error(
        `Value for "${key}" fails schema (${def.schema.describe}): ${check.message}`,
      );
    }

    const record: ConfigChangeRecord = {
      key,
      value,
      changedBy: context.changedBy,
      reason: context.reason,
      shadowEvalRef: context.shadowEvalRef ?? null,
      workspaceId: context.workspaceId ?? null,
      changedAt: new Date().toISOString(),
    };
    await this.store.setOverride(record);
  }

  /**
   * Stability graduation (DECISION_LIFECYCLE): forward-only;
   * experiment→stable requires shadow-eval evidence.
   */
  graduate(key: string, to: Stability, context: { changedBy: string; shadowEvalRef?: string }): void {
    const def = this.describe(key);
    if (STABILITY_ORDER[to] <= STABILITY_ORDER[def.stability]) {
      throw new Error(
        `Stability of "${key}" can only move forward (${def.stability} → ${to} is not a graduation)`,
      );
    }
    if (def.stability === "experiment" && to !== "experiment" && !context.shadowEvalRef) {
      throw new Error(
        `Graduating "${key}" out of experiment requires shadow-eval evidence (DECISION_LIFECYCLE.md)`,
      );
    }
    this.definitions.set(key, { ...def, stability: to });
  }

  async history(key: string, scope: ReadScope = {}): Promise<readonly ConfigChangeRecord[]> {
    this.describe(key); // unknown keys fail loudly
    return this.store.history(key, scope);
  }

  /**
   * Immutable, deterministic snapshot of every key's effective value for a
   * scope. The hash goes into decision traces (ADR-044); replaying with the
   * same snapshot must reproduce the same feed (I1 / AT-1).
   */
  async snapshot(scope: ReadScope = {}): Promise<ConfigSnapshot> {
    const keys = [...this.definitions.keys()].sort();
    const values: Record<string, unknown> = {};
    for (const key of keys) {
      values[key] = await this.get(key, scope);
    }
    Object.freeze(values);
    const hash = createHash("sha256")
      .update(JSON.stringify(values, keys))
      .digest("hex");
    return Object.freeze({
      hash,
      takenAt: new Date().toISOString(),
      workspaceId: scope.workspaceId ?? null,
      values,
    });
  }
}
