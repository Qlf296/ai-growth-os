/**
 * Connection health monitoring (ADR-021 health model). Reuses the existing
 * token refresh (refreshConnectionToken), error taxonomy (classifyError) and
 * the single health writer (updateConnectionHealth). Maps outcomes to the
 * operational health lifecycle, audits transitions and meters them.
 *
 * Backoff for temporary Google failures is the queue's job (ADR-003): a
 * degraded check throws nothing new — the caller records degraded and the
 * scheduled job retries with exponential backoff.
 */
import type pg from "pg";

import { updateConnectionHealth, type ConnectionHealth, type TokenVault } from "@aigos/database";
import type { MetricsRegistry } from "@aigos/infra";

import { classifyError } from "./capabilities.js";
import { refreshConnectionToken, type GoogleTokenEndpoint } from "./google-oauth.js";
import type { GscTransport } from "./gsc/transport.js";
import type { AdapterErrorKind } from "./types.js";

export function healthForErrorKind(kind: AdapterErrorKind): ConnectionHealth {
  switch (kind) {
    case "auth":
      return "reconnect_required"; // credentials expired/revoked → user must reconnect (ADR-019)
    case "capability_revoked":
      return "failed"; // permanent — permission removed at the provider
    default:
      return "degraded"; // transient | quota → retry via queue backoff
  }
}

export interface HealthCheckParams {
  readonly pool: pg.Pool;
  readonly vault: TokenVault;
  readonly endpoint: GoogleTokenEndpoint;
  readonly transportFactory: (accessToken: string) => GscTransport;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly clock: () => Date;
  readonly metrics?: MetricsRegistry;
}

export interface HealthCheckResult {
  readonly health: ConnectionHealth;
  readonly changed: boolean;
}

/**
 * Refresh the token if needed, probe the provider, and record the resulting
 * health. Never throws for expected provider conditions — the health state IS
 * the result; the caller/queue decides on retries.
 */
export async function checkConnectionHealth(params: HealthCheckParams): Promise<HealthCheckResult> {
  let health: ConnectionHealth;
  let reason: string;
  try {
    // refreshConnectionToken refreshes when expired; auth failure ⇒ connection status expired.
    const accessToken = await refreshConnectionToken({
      pool: params.pool,
      vault: params.vault,
      endpoint: params.endpoint,
      workspaceId: params.workspaceId,
      connectionId: params.connectionId,
      clock: params.clock,
    });
    await params.transportFactory(accessToken).listSites(); // cheap liveness probe
    health = "healthy";
    reason = "live probe ok";
  } catch (error) {
    const kind = classifyError(error).kind;
    health = healthForErrorKind(kind);
    reason = error instanceof Error ? error.message : String(error);
  }

  const transition = await updateConnectionHealth(params.pool, params.workspaceId, params.connectionId, health, reason);
  params.metrics?.counter(`connection.health.${transition.to}`).inc();
  return { health: transition.to, changed: transition.changed };
}
