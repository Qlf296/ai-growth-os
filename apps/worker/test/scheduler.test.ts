/**
 * Scheduler (ADR-003): definitions are data; due jobs enqueue with idempotent
 * keys so N worker replicas never double-fire; failures are isolated.
 */
import { describe, expect, it } from "vitest";

import { InMemoryJobQueue } from "@aigos/infra";

import { tick, type JobDefinition } from "../src/scheduler.js";

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
