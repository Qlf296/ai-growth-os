/**
 * Synthetic-canary stub (BUILD_RULES step 9). The full spine run
 * (fixture signals → rules → action → feed → mock outcome) is the Phase 0
 * exit gate (S20) and lands with step 11 verification; this stub proves the
 * scheduling + observability path end to end.
 */
import type { Logger, MetricsRegistry } from "@aigos/infra";

import type { SchedulerPayload } from "./scheduler.js";

export function canaryHandler(logger: Logger, metrics: MetricsRegistry) {
  return async (job: { jobId: string; payload: SchedulerPayload }): Promise<void> => {
    await metrics.span("canary.run_ms", async () => {
      metrics.counter("canary.runs").inc();
      logger.info("canary run", { jobId: job.jobId, scheduledFor: job.payload.scheduledFor });
    });
  };
}
