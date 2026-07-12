/**
 * Automation job handler (family automation.run). Reuses the scheduler + queue
 * (ADR-003): a trigger event enqueues a run; the executor persists outcomes
 * idempotently, so retries and the DLQ are safe. The action registry is
 * injected by the worker boot (no publishing actions — Law 5).
 */
import type pg from "pg";

import { runAutomationForEvent, type ActionRegistry } from "@aigos/automation";
import type { MetricsRegistry } from "@aigos/infra";

import type { SchedulerPayload } from "./scheduler.js";

export interface AutomationJobPayload extends SchedulerPayload {
  readonly params: { workspaceId: string; triggerType: string; triggerRef: string; fact: Record<string, unknown> };
}

export interface AutomationDeps {
  readonly pool: pg.Pool;
  readonly registry: ActionRegistry;
  readonly metrics: MetricsRegistry;
}

export function createAutomationHandler(deps: AutomationDeps) {
  return async (job: { jobId: string; payload: SchedulerPayload }): Promise<void> => {
    const p = (job.payload as AutomationJobPayload).params;
    await deps.metrics.span("automation.run_ms", async () => {
      const r = await runAutomationForEvent(deps.pool, deps.registry, p.workspaceId, p.triggerType, p.fact, p.triggerRef);
      deps.metrics.counter("automation.ran").inc(r.ran);
      deps.metrics.counter("automation.errors").inc(r.errors);
    });
  };
}
