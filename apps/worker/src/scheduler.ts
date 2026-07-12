/**
 * Scheduler (ADR-003): reads recurring definitions (Postgres — schedules are
 * data), enqueues occurrences that fall inside the tick window. Stateless:
 * the queue's idempotent jobId (family:occurrenceISO) makes replicas and
 * restarts safe. No occurrence state to persist, nothing durable in Redis.
 */
import { CronExpressionParser } from "cron-parser";

import type { JobQueue } from "@aigos/infra";

export interface JobDefinition {
  readonly id: string;
  readonly workspaceId: string | null;
  readonly jobFamily: string;
  readonly schedule: string; // cron expr
  readonly params: Record<string, unknown>;
}

export interface SchedulerPayload extends Record<string, unknown> {
  readonly family: string;
  readonly params: Record<string, unknown>;
  readonly workspaceId: string | null;
  readonly scheduledFor: string;
}

export interface TickWindow {
  readonly windowStart: Date; // exclusive
  readonly now: Date;         // inclusive
}

/** Enqueue every due occurrence; returns enqueued jobIds (for logs/tests). */
export async function tick(
  definitions: readonly JobDefinition[],
  queue: JobQueue<SchedulerPayload>,
  window: TickWindow,
): Promise<string[]> {
  const enqueued: string[] = [];
  for (const def of definitions) {
    let occurrence: Date | null = null;
    try {
      const cron = CronExpressionParser.parse(def.schedule, { currentDate: window.now, tz: "UTC" });
      const prev = cron.prev().toDate();
      if (prev > window.windowStart && prev <= window.now) occurrence = prev;
    } catch {
      continue; // invalid cron: skip this definition, never break the tick (isolation)
    }
    if (!occurrence) continue;
    const jobId = `${def.jobFamily}:${def.id}:${occurrence.toISOString()}`;
    await queue.enqueue({
      jobId,
      payload: {
        family: def.jobFamily,
        params: def.params,
        workspaceId: def.workspaceId,
        scheduledFor: occurrence.toISOString(),
      },
    });
    enqueued.push(jobId);
  }
  return enqueued;
}
