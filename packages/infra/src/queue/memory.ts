/** In-memory JobQueue driver — same contract as the BullMQ driver, no Redis. Dev/tests only. */
import {
  DEFAULT_RETRY,
  type DeadLetter,
  type JobHandler,
  type JobQueue,
  type JobSpec,
  type RetryPolicy,
} from "./types.js";

export class InMemoryJobQueue<P> implements JobQueue<P> {
  private readonly seen = new Set<string>();
  private readonly pending: JobSpec<P>[] = [];
  private handler: JobHandler<P> | null = null;
  readonly deadLetters: DeadLetter[] = [];

  constructor(private readonly retry: RetryPolicy = DEFAULT_RETRY) {}

  enqueue(spec: JobSpec<P>): Promise<void> {
    if (!this.seen.has(spec.jobId)) {
      this.seen.add(spec.jobId); // idempotency by key
      this.pending.push(spec);
    }
    return Promise.resolve();
  }

  process(handler: JobHandler<P>): void {
    this.handler = handler;
  }

  /** Run until the queue is empty (tests drive time explicitly). */
  async drain(): Promise<void> {
    if (!this.handler) throw new Error("no handler registered");
    for (let spec = this.pending.shift(); spec; spec = this.pending.shift()) {
      let lastError = "";
      for (let attempt = 1; attempt <= this.retry.attempts; attempt++) {
        try {
          await this.handler({ ...spec, attempt });
          lastError = "";
          break;
        } catch (error) {
          lastError = (error as Error).message;
          if (this.retry.backoffMs > 0) {
            await new Promise((r) => setTimeout(r, this.retry.backoffMs * 2 ** (attempt - 1)));
          }
        }
      }
      if (lastError) {
        this.deadLetters.push({ jobId: spec.jobId, error: lastError, attempts: this.retry.attempts });
      }
    }
  }
}
