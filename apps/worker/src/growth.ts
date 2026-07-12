/**
 * Growth build job handler (family growth.build). Reuses the scheduler + queue
 * (ADR-003): builds the day's opportunities + recommendations from findings,
 * deterministically and idempotently.
 */
import type pg from "pg";

import type { ConfigRegistry } from "@aigos/config-registry";
import { buildGrowth } from "@aigos/growth";
import type { MetricsRegistry } from "@aigos/infra";

import type { SchedulerPayload } from "./scheduler.js";

export interface GrowthJobPayload extends SchedulerPayload {
  readonly params: { workspaceId: string };
}

export interface GrowthDeps {
  readonly pool: pg.Pool;
  readonly config: ConfigRegistry;
  readonly metrics: MetricsRegistry;
}

const dayString = (iso: string): string => new Date(iso).toISOString().slice(0, 10);

export function createGrowthHandler(deps: GrowthDeps) {
  return async (job: { jobId: string; payload: SchedulerPayload }): Promise<void> => {
    const { workspaceId } = (job.payload as GrowthJobPayload).params;
    await deps.metrics.span("growth.run_ms", async () => {
      const summary = await buildGrowth({
        pool: deps.pool,
        config: deps.config,
        workspaceId,
        day: dayString(job.payload.scheduledFor),
        metrics: deps.metrics,
      });
      deps.metrics.counter("growth.opportunities_total").inc(summary.opportunities);
    });
  };
}
