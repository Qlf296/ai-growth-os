/**
 * ADR-046 — config-as-data (+stability).
 * Every tunable lives here, not in code (BUILD_RULES non-negotiable #6).
 */

/** Stability ladder. Forward-only: experiment → stable → frozen. */
export type Stability = "experiment" | "stable" | "frozen";

/** Validation result for a config value. */
export type SchemaResult =
  | { ok: true }
  | { ok: false; message: string };

/** Minimal schema contract — a pure validation function plus a description. */
export interface ConfigSchema<T> {
  readonly describe: string;
  validate(value: unknown): SchemaResult;
  /** Type-carrier only; never assigned at runtime. */
  readonly __type?: T;
}

export interface ConfigKeyDefinition<T = unknown> {
  /** Namespaced key, e.g. `recommendation.w_goal`. */
  readonly key: string;
  readonly description: string;
  /** Owning module (S2 §2) — every tunable has an owner, like every SLI (ADR-047). */
  readonly owner: string;
  readonly stability: Stability;
  /**
   * ADR-045 / AT-14: changes to decision-affecting keys cannot activate
   * without a linked shadow evaluation.
   */
  readonly decisionAffecting: boolean;
  readonly schema: ConfigSchema<T>;
  readonly defaultValue: T;
}

/** Audit fields required on every change. History is append-only. */
export interface ChangeContext {
  readonly changedBy: string;
  readonly reason: string;
  /** Required when the key is decision-affecting (ADR-045). */
  readonly shadowEvalRef?: string;
  /** Absent ⇒ global override; present ⇒ workspace-scoped override. */
  readonly workspaceId?: string;
}

export interface ConfigChangeRecord {
  readonly key: string;
  readonly value: unknown;
  readonly changedBy: string;
  readonly reason: string;
  readonly shadowEvalRef: string | null;
  readonly workspaceId: string | null;
  readonly changedAt: string; // ISO-8601
}

export interface ReadScope {
  readonly workspaceId?: string;
}

/**
 * Immutable, hash-addressed view of the registry (I1 feed determinism;
 * referenced by decision traces, ADR-044).
 */
export interface ConfigSnapshot {
  readonly hash: string;
  readonly takenAt: string;
  readonly workspaceId: string | null;
  readonly values: Readonly<Record<string, unknown>>;
}

/**
 * Storage boundary. In-memory for Phase 0 step 2; a Postgres-backed store
 * arrives with `packages/database` (step 3). The registry is the ONLY writer
 * of its store (I5 — one writer per store).
 */
export interface ConfigStore {
  getOverride(key: string, workspaceId: string | null): Promise<unknown | undefined>;
  setOverride(record: ConfigChangeRecord): Promise<void>;
  /**
   * Change log for a key. RLS-aligned visibility: global records always;
   * workspace records only when `scope.workspaceId` is provided (tenant
   * isolation holds even for config — I9).
   */
  history(key: string, scope?: ReadScope): Promise<readonly ConfigChangeRecord[]>;
  /** All overrides visible in the given scope — used by snapshot assembly. */
  allOverrides(scope?: ReadScope): Promise<readonly ConfigChangeRecord[]>;
}
