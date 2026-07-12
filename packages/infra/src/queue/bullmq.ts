/**
 * BullMQ driver (ADR-003). Thin: all policy lives in toBullJobOptions (pure,
 * unit-tested); BullMQ handles delivery. Nothing durable lives in Redis
 * (S2 §6): completed jobs are pruned, failed jobs land in the DLQ handler
 * which persists to Postgres (audit_log) — wired with the worker (step 5).
 * Redis integration test runs in CI (step 10 gate).
 */
import { Queue, Worker, type ConnectionOptions, type JobsOptions } from "bullmq";

import {
  DEFAULT_RETRY,
  type JobHandler,
  type JobQueue,
  type JobSpec,
  type RetryPolicy,
} from "./types.js";

export function toBullJobOptions(jobId: string, retry: RetryPolicy): JobsOptions {
  return {
    jobId,
    attempts: retry.attempts,
    backoff: { type: "exponential", delay: retry.backoffMs },
    removeOnComplete: { count: 100 },
    removeOnFail: false, // kept for the DLQ drain; Redis is still not the durable record
  };
}

export class BullJobQueue<P extends Record<string, unknown>> implements JobQueue<P> {
  private readonly queue: Queue;
  private worker: Worker | null = null;

  constructor(
    private readonly name: string,
    private readonly connection: ConnectionOptions,
    private readonly retry: RetryPolicy = DEFAULT_RETRY,
    private readonly onDeadLetter?: (jobId: string, error: string) => Promise<void>,
  ) {
    this.queue = new Queue(name, { connection });
  }

  async enqueue(spec: JobSpec<P>): Promise<void> {
    await this.queue.add(this.name, spec.payload, toBullJobOptions(spec.jobId, this.retry));
  }

  process(handler: JobHandler<P>): void {
    this.worker = new Worker(
      this.name,
      async (job) =>
        handler({ jobId: String(job.id), payload: job.data as P, attempt: job.attemptsMade + 1 }),
      { connection: this.connection },
    );
    this.worker.on("failed", (job, error) => {
      if (job && job.attemptsMade >= this.retry.attempts && this.onDeadLetter) {
        void this.onDeadLetter(String(job.id), error.message);
      }
    });
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}
