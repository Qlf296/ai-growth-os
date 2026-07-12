/** ADR-003 — Redis-backed job queue. Jobs are idempotent (keyed), retries bounded, failures dead-lettered. */

export interface RetryPolicy {
  /** Bounded — never infinite (ADR-003). */
  readonly attempts: number;
  /** Base delay for exponential backoff. */
  readonly backoffMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { attempts: 5, backoffMs: 5_000 };

export interface JobSpec<P> {
  /** Idempotency key — re-enqueueing the same jobId is a no-op. */
  readonly jobId: string;
  readonly payload: P;
}

export interface ActiveJob<P> extends JobSpec<P> {
  readonly attempt: number;
}

export interface DeadLetter {
  readonly jobId: string;
  readonly error: string;
  readonly attempts: number;
}

export type JobHandler<P> = (job: ActiveJob<P>) => Promise<void>;

/** Port implemented by the BullMQ driver (production) and the in-memory driver (dev/tests). */
export interface JobQueue<P> {
  enqueue(spec: JobSpec<P>): Promise<void>;
  process(handler: JobHandler<P>): void;
}
