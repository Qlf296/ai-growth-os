/**
 * Adapter operational contract (ADR-021) — the framework, no providers.
 * Capabilities are data (ADR-007): pipelines and UI consult the manifest,
 * never provider names. Failure honesty: every error carries its kind.
 */
import type { ConfigKeyDefinition } from "@aigos/config-registry";

/** e.g. { read_search_analytics: true, publish: "deeplink_only", read_feed: false } */
export type CapabilityManifest = Readonly<Record<string, boolean | string>>;

/** ADR-021 §6 — transient | quota | auth | capability_revoked. */
export type AdapterErrorKind = "transient" | "quota" | "auth" | "capability_revoked";

export class AdapterError extends Error {
  constructor(
    readonly kind: AdapterErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export interface AdapterDescriptor {
  readonly provider: string;
  /** Declared API version — deprecation watch polls against it (ADR-021 §5). */
  readonly apiVersion: string;
  readonly capabilities: CapabilityManifest;
  /** Job family of this adapter's deprecation_check (scheduled_jobs row, ADR-003). */
  readonly deprecationCheckJobFamily: string;
  /** The adapter's tunables — registered into the ADR-046 registry at boot. */
  readonly configKeys: readonly ConfigKeyDefinition[];
}

/** Provider work arrives in later steps; the contract is fixed here. */
export interface Adapter {
  readonly descriptor: AdapterDescriptor;
  /** Cheap provider-side liveness/authorization probe. Throws AdapterError (or anything → transient). */
  healthCheck(context: { connectionId: string; workspaceId: string }): Promise<void>;
}

export type HealthResult =
  | { healthy: true }
  | { healthy: false; kind: AdapterErrorKind; message: string };
