/** Capability guards (ADR-007/041): a missing capability is a typed refusal, never a silent no-op. */
import { AdapterError, type CapabilityManifest } from "./types.js";

export function requireCapability(manifest: CapabilityManifest, capability: string): boolean | string {
  const value = manifest[capability];
  if (value === undefined || value === false) {
    throw new AdapterError(
      "capability_revoked",
      `Capability "${capability}" is not granted by this connection's manifest`,
    );
  }
  return value;
}

/** ADR-021 §6: typed errors pass through; anything unknown is honestly transient. */
export function classifyError(error: unknown): AdapterError {
  if (error instanceof AdapterError) return error;
  return new AdapterError("transient", error instanceof Error ? error.message : String(error));
}
