/**
 * Scheduler (ADR-003): definitions are data; due jobs enqueue with idempotent
 * keys so N worker replicas never double-fire; failures are isolated.
 */
import { describe, expect, it } from "vitest";

import { InMemoryJobQueue, InMemoryLock } from "@aigos/infra";

import { tick, catchUp, type JobDefinition } from "../src/scheduler.js";

const defs = (over: Partial<JobDefinition> = {}): JobDefinition[] => [
  {
    id: "d1",
    workspaceId: null,
    jobFamily: "canary.spine",
    schedule: "0 6 * * *", // daily 06:00 UTC
    params: {},
    ...over,
  },
];

describe("scheduler tick", () => {
  it("enqueues a job whose cron time falls inside the tick window", async () => {
    const q = new InMemoryJobQueue<{ family: string }>();
    const enqueued = await tick(defs(), q, {
      windowStart: new Date("2026-07-12T05:59:00Z"),
      now: new Date("2026-07-12T06:00:30Z"),
    });
    expect(enqueued).toEqual(["canary.spine:d1:2026-07-12T06:00:00.000Z"]);
  });

  it("does nothing when no occurrence falls in the window", async () => {
    const q = new InMemoryJobQueue<{ family: string }>();
    const enqueued = await tick(defs(), q, {
      windowStart: new Date("2026-07-12T07:00:00Z"),
      now: new Date("2026-07-12T07:01:00Z"),
    });
    expect(enqueued).toEqual([]);
  });

  it("two replicas ticking the same window double-fire nothing (idempotent jobId)", async () => {
    const q = new InMemoryJobQueue<{ family: string }>();
    const w = { windowStart: new Date("2026-07-12T05:59:00Z"), now: new Date("2026-07-12T06:01:00Z") };
    await tick(defs(), q, w);
    await tick(defs(), q, w);
    let processed = 0;
    q.process(async () => {
      processed++;
    });
    await q.drain();
    expect(processed).toBe(1);
  });

  it("an invalid cron in one definition does not break the others", async () => {
    const q = new InMemoryJobQueue<{ family: string }>();
    const bad: JobDefinition = { id: "bad", workspaceId: null, jobFamily: "broken", schedule: "not a cron", params: {} };
    const enqueued = await tick([bad, ...defs()], q, {
      windowStart: new Date("2026-07-12T05:59:00Z"),
      now: new Date("2026-07-12T06:00:30Z"),
    });
    expect(enqueued).toEqual(["canary.spine:d1:2026-07-12T06:00:00.000Z"]);
  });

  it("payload carries family, params and workspace scope for the dispatcher", async () => {
    const q = new InMemoryJobQueue<Record<string, unknown>>();
    await tick(defs({ params: { source: "gsc" }, workspaceId: "ws1" }), q, {
      windowStart: new Date("2026-07-12T05:59:00Z"),
      now: new Date("2026-07-12T06:00:30Z"),
    });
    const seen: Record<string, unknown>[] = [];
    q.process(async (job) => {
      seen.push(job.payload);
    });
    await q.drain();
    expect(seen[0]).toEqual({
      family: "canary.spine",
      params: { source: "gsc" },
      workspaceId: "ws1",
      scheduledFor: "2026-07-12T06:00:00.000Z",
    });
  });
});

describe("scheduler catchUp (missed-job replay + recovery)", () => {
  it("replays every missed occurrence across a multi-day downtime gap", async () => {
    const q = new InMemoryJobQueue<Record<string, unknown>>();
    // Worker was down from Jul 9 to Jul 12 → three daily 06:00 occurrences missed.
    const enqueued = await catchUp(defs(), q, {
      windowStart: new Date("2026-07-09T00:00:00Z"),
      now: new Date("2026-07-12T06:05:00Z"),
    });
    expect(enqueued).toEqual([
      "canary.spine:d1:2026-07-09T06:00:00.000Z",
      "canary.spine:d1:2026-07-10T06:00:00.000Z",
      "canary.spine:d1:2026-07-11T06:00:00.000Z",
      "canary.spine:d1:2026-07-12T06:00:00.000Z",
    ]);
  });

  it("bounds replay by maxOccurrencesPerJob (no runaway after long downtime)", async () => {
    const q = new InMemoryJobQueue<Record<string, unknown>>();
    const enqueued = await catchUp(defs(), q, {
      windowStart: new Date("2026-01-01T00:00:00Z"),
      now: new Date("2026-07-12T06:05:00Z"),
    }, { maxOccurrencesPerJob: 2 });
    expect(enqueued).toHaveLength(2);
  });

  it("is idempotent: replaying the same gap twice fires each occurrence once", async () => {
    const q = new InMemoryJobQueue<Record<string, unknown>>();
    const w = { windowStart: new Date("2026-07-10T00:00:00Z"), now: new Date("2026-07-12T06:05:00Z") };
    await catchUp(defs(), q, w);
    await catchUp(defs(), q, w);
    let processed = 0;
    q.process(async () => {
      processed++;
    });
    await q.drain();
    expect(processed).toBe(3); // Jul 10, 11, 12 — once each despite double replay
  });

  it("runs the tick under a distributed lock — only the leader enqueues", async () => {
    const q = new InMemoryJobQueue<Record<string, unknown>>();
    const lock = new InMemoryLock();
    const w = { windowStart: new Date("2026-07-12T05:59:00Z"), now: new Date("2026-07-12T06:00:30Z") };
    let held: string[] | null = null;
    const leader = lock.withLock("scheduler:tick", 30_000, async () => {
      // competing replica cannot acquire while the leader holds the lock
      const loser = await lock.withLock("scheduler:tick", 30_000, () => catchUp(defs(), q, w));
      expect(loser).toBeNull();
      held = await catchUp(defs(), q, w);
      return held;
    });
    await leader;
    expect(held).toEqual(["canary.spine:d1:2026-07-12T06:00:00.000Z"]);
  });
});
