/**
 * Connection lifecycle (S3 §3 statuses; ADR-019 reauth semantics) and the
 * health-check runner. Status mapping from failure kinds:
 * auth → expired (reauth prerequisite) · capability_revoked → error ·
 * transient/quota → status untouched (a blip is not an incident).
 */
import type pg from "pg";

import type { ConfigRegistry } from "@aigos/config-registry";
import { ConnectionRepository, withWorkspace } from "@aigos/database";

import { classifyError } from "./capabilities.js";
import type { Adapter, AdapterDescriptor, AdapterErrorKind, HealthResult } from "./types.js";

type Status = "active" | "expired" | "revoked" | "error";

const TRANSITIONS: Record<Status, readonly Status[]> = {
  active: ["expired", "revoked", "error"],
  expired: ["active", "revoked"],
  error: ["active", "expired", "revoked"],
  revoked: ["active"], // explicit reauth only (ADR-019)
};

const repo = new ConnectionRepository();

export async function applyConnectionStatus(
  pool: pg.Pool,
  workspaceId: string,
  connectionId: string,
  next: Status,
): Promise<void> {
  await withWorkspace(pool, workspaceId, async (tx) => {
    const current = await tx.query(`SELECT status FROM connections WHERE id = $1`, [connectionId]);
    if (!current.rowCount) throw new Error(`connection not found: ${connectionId}`);
    const from = (current.rows[0] as { status: Status }).status;
    if (!TRANSITIONS[from].includes(next)) {
      throw new Error(`illegal status transition ${from} → ${next} (S3 §3)`);
    }
    await repo.setStatus(tx, connectionId, next);
  });
}

const STATUS_FOR_KIND: Partial<Record<AdapterErrorKind, Status>> = {
  auth: "expired",
  capability_revoked: "error",
};

export async function runHealthCheck(
  pool: pg.Pool,
  workspaceId: string,
  connectionId: string,
  adapter: Adapter,
): Promise<HealthResult> {
  let result: HealthResult;
  try {
    await adapter.healthCheck({ connectionId, workspaceId });
    result = { healthy: true };
  } catch (error) {
    const classified = classifyError(error);
    result = { healthy: false, kind: classified.kind, message: classified.message };
  }
  await withWorkspace(pool, workspaceId, async (tx) => {
    await tx.query(`UPDATE connections SET health_checked_at = now() WHERE id = $1`, [connectionId]);
  });
  if (!result.healthy) {
    const next = STATUS_FOR_KIND[result.kind];
    if (next) await applyConnectionStatus(pool, workspaceId, connectionId, next);
  }
  return result;
}

/** Adapter tunables live in the ADR-046 registry like everything else. */
export function registerAdapterConfig(config: ConfigRegistry, descriptor: AdapterDescriptor): void {
  for (const key of descriptor.configKeys) config.define(key);
}
