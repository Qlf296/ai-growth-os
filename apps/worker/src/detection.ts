/**
 * Detection job handler (family detection.run). Reuses the existing scheduler
 * and queue (ADR-003): the scheduled row enqueues a run; the engine executes
 * deterministically and idempotently over normalized signals, writing evidence,
 * findings and run history. Retries and backoff are the queue's job.
 */
import type pg from "pg";

import type { MetricsRegistry } from "@aigos/infra";
import { runDetection } from "@aigos/intelligence";

import type { SchedulerPayload } from "./scheduler.js";

export interface DetectionJobPayload extends SchedulerPayload {
  readonly params: { workspaceId: string };
}

export interface DetectionDeps {
  readonly pool: pg.Pool;
  readonly metrics: MetricsRegistry;
  readonly windowDays?: number;
}

export function createDetectionHandler(deps: DetectionDeps) {
  return async (job: { jobId: string; payload: SchedulerPayload }): Promise<void> => {
    const { workspaceId } = (job.payload as DetectionJobPayload).params;
    await deps.metrics.span("detection.run_ms", async () => {
      const summary = await runDetection({
        pool: deps.pool,
        workspaceId,
        now: new Date(job.payload.scheduledFor),
        ...(deps.windowDays !== undefined ? { windowDays: deps.windowDays } : {}),
        metrics: deps.metrics,
      });
      deps.metrics.counter("detection.findings_total").inc(summary.findings);
    });
  };
}
