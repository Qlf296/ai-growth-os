/**
 * Outcome evaluation scheduler handler (family outcomes.evaluate). Reuses the
 * scheduler + queue (ADR-003): for opportunities that were completed at least
 * `windowDays` ago and not yet measured, it reads the immutable baseline,
 * measures the current metric, grades and stores the outcome (evidence-backed,
 * idempotent). Delayed evaluation is enforced by the window; duplicates are
 * prevented by the outcome idempotency key.
 */
import type pg from "pg";

import { getBaseline, withWorkspace } from "@aigos/database";
import { recordOutcome, type Attribution } from "@aigos/analytics";
import type { MetricsRegistry } from "@aigos/infra";

import type { SchedulerPayload } from "./scheduler.js";

export interface OutcomesJobPayload extends SchedulerPayload {
  readonly params: { workspaceId: string; metric: string; windowDays: number };
}

export interface OutcomesDeps {
  readonly pool: pg.Pool;
  readonly metrics: MetricsRegistry;
  /** Provides the current observed metric value for a subject (e.g. from signals). */
  readonly observe: (workspaceId: string, opportunityId: string, metric: string) => Promise<number | null>;
  readonly attribution?: (workspaceId: string, opportunityId: string) => Promise<Attribution>;
}

const DAY = 86_400_000;

/** Opportunities completed at least windowDays ago and not yet measured for this metric. */
export async function pendingEvaluations(pool: pg.Pool, workspaceId: string, metric: string, windowDays: number, now: Date): Promise<string[]> {
  const cutoff = new Date(now.getTime() - windowDays * DAY);
  const r = await withWorkspace(pool, workspaceId, (tx) =>
    tx.query(
      `SELECT o.id FROM opportunities o
       WHERE o.status = 'completed' AND o.updated_at <= $1
         AND NOT EXISTS (SELECT 1 FROM outcome_evaluations oe WHERE oe.subject_id = o.id AND oe.metric = $2)
       ORDER BY o.updated_at`,
      [cutoff, metric],
    ),
  );
  return (r.rows as Array<{ id: string }>).map((x) => x.id);
}

export function createOutcomesHandler(deps: OutcomesDeps) {
  return async (job: { jobId: string; payload: SchedulerPayload }): Promise<void> => {
    const p = (job.payload as OutcomesJobPayload).params;
    const now = new Date(job.payload.scheduledFor);
    await deps.metrics.span("outcomes.run_ms", async () => {
      const pending = await pendingEvaluations(deps.pool, p.workspaceId, p.metric, p.windowDays, now);
      for (const opportunityId of pending) {
        const baseline = await getBaseline(deps.pool, p.workspaceId, opportunityId, p.metric);
        const observed = await deps.observe(p.workspaceId, opportunityId, p.metric);
        const attribution = deps.attribution ? await deps.attribution(p.workspaceId, opportunityId) : undefined;
        await recordOutcome(deps.pool, p.workspaceId, {
          subjectType: "opportunity", subjectId: opportunityId, metric: p.metric,
          baselineValue: baseline?.baselineValue ?? null, observedValue: observed,
          windowDays: p.windowDays, targetImprovement: 0.1,
          ...(attribution ? { attribution } : {}),
        });
        deps.metrics.counter("outcomes.evaluated").inc();
      }
    });
  };
}
