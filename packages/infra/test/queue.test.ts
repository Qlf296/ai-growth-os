/**
 * ADR-003 contract: idempotent (keyed) jobs, bounded retries with backoff,
 * dead-letter queue. Contract-tested on the in-memory driver; the BullMQ
 * driver maps the same policy to BullMQ options (pure mapping, tested here;
 * Redis integration runs in CI — step 10).
 */
import { describe, expect, it, vi } from "vitest";

import { InMemoryJobQueue } from "../src/queue/memory.js";
import { toBullJobOptions } from "../src/queue/bullmq.js";
import { DEFAULT_RETRY } from "../src/queue/types.js";

describe("queue contract (in-memory driver)", () => {
  it("processes an enqueued job", async () => {
    const q = new InMemoryJobQueue<{ n: number }>();
    const seen: number[] = [];
    q.process(async (job) => {
      seen.push(job.payload.n);
    });
    await q.enqueue({ jobId: "job-1", payload: { n: 42 } });
    await q.drain();
    expect(seen).toEqual([42]);
  });

  it("is idempotent by jobId: re-enqueueing the same key is a no-op", async () => {
    const q = new InMemoryJobQueue<{ n: number }>();
    const handler = vi.fn(async () => {});
    q.process(handler);
    await q.enqueue({ jobId: "dup", payload: { n: 1 } });
    await q.enqueue({ jobId: "dup", payload: { n: 1 } });
    await q.drain();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("retries with bounded attempts then dead-letters", async () => {
    const q = new InMemoryJobQueue<{ n: number }>({ attempts: 3, backoffMs: 0 });
    let calls = 0;
    q.process(async () => {
      calls++;
      throw new Error("provider 500");
    });
    await q.enqueue({ jobId: "flaky", payload: { n: 1 } });
    await q.drain();
    expect(calls).toBe(3); // bounded — never infinite
    expect(q.deadLetters).toHaveLength(1);
    expect(q.deadLetters[0]?.jobId).toBe("flaky");
    expect(q.deadLetters[0]?.error).toMatch(/provider 500/);
  });

  it("a job that succeeds on retry does not dead-letter", async () => {
    const q = new InMemoryJobQueue<{ n: number }>({ attempts: 3, backoffMs: 0 });
    let calls = 0;
    q.process(async () => {
      calls++;
      if (calls < 2) throw new Error("transient");
    });
    await q.enqueue({ jobId: "recovers", payload: { n: 1 } });
    await q.drain();
    expect(calls).toBe(2);
    expect(q.deadLetters).toHaveLength(0);
  });
});

describe("BullMQ option mapping (pure, ADR-003)", () => {
  it("maps the retry policy to bounded attempts + exponential backoff + jobId", () => {
    const opts = toBullJobOptions("job-key-1", { attempts: 5, backoffMs: 2000 });
    expect(opts.jobId).toBe("job-key-1"); // idempotency key
    expect(opts.attempts).toBe(5);
    expect(opts.backoff).toEqual({ type: "exponential", delay: 2000 });
    expect(opts.removeOnComplete).toBeTruthy(); // nothing durable lives in Redis (S2 §6)
  });

  it("defaults are bounded (never infinite retries)", () => {
    const opts = toBullJobOptions("k", DEFAULT_RETRY);
    expect(opts.attempts).toBeGreaterThan(0);
    expect(opts.attempts).toBeLessThanOrEqual(10);
  });
});
