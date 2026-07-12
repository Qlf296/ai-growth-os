/**
 * Evidence engine (STEP 3.4; ADR-035 single generator; I4 — no claim without
 * evidence). Evidence is content-addressed: the id is a deterministic hash of
 * (generator, data), so identical inputs yield the same evidence row →
 * reproducible and idempotent. Evidence carries the metrics, samples and window
 * that answer "why do you believe that?" (ADR-025).
 */
import { createHash } from "node:crypto";

export interface EvidenceInput {
  readonly generatedBy: string; // detector@version
  readonly data: Record<string, unknown>;
}

export interface Evidence extends EvidenceInput {
  readonly id: string;
}

/** Stable stringify (sorted keys) so equal evidence hashes equally. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function makeEvidence(input: EvidenceInput): Evidence {
  const id = createHash("sha256").update(`${input.generatedBy}|${stable(input.data)}`).digest("hex");
  // Format as a uuid-shaped string for the uuid column (first 32 hex → 8-4-4-4-12).
  const uuid = `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
  return { id: uuid, ...input };
}
