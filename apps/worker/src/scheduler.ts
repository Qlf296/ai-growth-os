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

export interface CatchUpOptions {
  /** Cap per definition so a long downtime cannot enqueue an unbounded backlog. */
  readonly maxOccurrencesPerJob?: number;
}

/**
 * Every cron occurrence in `(windowStart, now]`, oldest first, capped by `max`.
 * Shared by `tick` (narrow window ⇒ one occurrence) and `catchUp` (wide window
 * after downtime ⇒ replay). Deterministic; invalid crons yield no occurrences.
 */
function occurrencesInWindow(schedule: string, window: TickWindow, max: number): Date[] {
  const out: Date[] = [];
  try {
    const cron = CronExpressionParser.parse(schedule, { currentDate: window.windowStart, tz: "UTC" });
    while (out.length < max) {
      const next = cron.next().toDate(); // strictly after windowStart, then advancing
      if (next > window.now) break;
      out.push(next);
    }
  } catch {
    return []; // invalid cron: skip this definition, never break the tick (isolation)
  }
  return out;
}

async function enqueueOccurrences(
  definitions: readonly JobDefinition[],
  queue: JobQueue<SchedulerPayload>,
  window: TickWindow,
  max: number,
): Promise<string[]> {
  const enqueued: string[] = [];
  for (const def of definitions) {
    for (const occurrence of occurrencesInWindow(def.schedule, window, max)) {
      const jobId = `${def.jobFamily}:${def.id}:${occurrence.toISOString()}`;
      await queue.enqueue({
        jobId, // idempotent: replicas, restarts and replays never double-fire
        payload: {
          family: def.jobFamily,
          params: def.params,
          workspaceId: def.workspaceId,
          scheduledFor: occurrence.toISOString(),
        },
      });
      enqueued.push(jobId);
    }
  }
  return enqueued;
}

/** Enqueue the single due occurrence for a narrow tick window; returns jobIds. */
export function tick(
  definitions: readonly JobDefinition[],
  queue: JobQueue<SchedulerPayload>,
  window: TickWindow,
): Promise<string[]> {
  return enqueueOccurrences(definitions, queue, window, 1);
}

/**
 * Missed-job replay / recovery-after-restart: enqueue every occurrence missed
 * since `windowStart` (e.g. the persisted last-tick time), oldest first,
 * bounded by `maxOccurrencesPerJob`. Idempotent jobIds make replay safe.
 */
export function catchUp(
  definitions: readonly JobDefinition[],
  queue: JobQueue<SchedulerPayload>,
  window: TickWindow,
  opts: CatchUpOptions = {},
): Promise<string[]> {
  return enqueueOccurrences(definitions, queue, window, opts.maxOccurrencesPerJob ?? 1000);
}
