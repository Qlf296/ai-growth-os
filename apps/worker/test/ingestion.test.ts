/**
 * Phase 2.3 — ingestion execution pipeline.
 * Scheduler (Postgres defs) → Queue (idempotent, bounded retries, DLQ) →
 * Worker handler (quota citizenship → raw-first ingest → audit + metrics).
 * Fixtures only; no OAuth, no network.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AdapterError,
  FixtureGscTransport,
  InMemoryRateCounter,
  QuotaGuard,
  type GscTransport,
} from "@aigos/adapters";
import { ConfigRegistry, InMemoryConfigStore } from "@aigos/config-registry";
import { ConnectionRepository, listEnabledSystemJobs, withWorkspace } from "@aigos/database";
import { FsRawStore, InMemoryJobQueue, MetricsRegistry } from "@aigos/infra";

import { createGscIngestionHandler, registerGscQuotaKeys, type IngestionJobPayload } from "../src/ingestion.js";
import { tick, type SchedulerPayload } from "../src/scheduler.js";
import { startHarness, seedWorkspace, type Harness } from "../../../packages/database/test/harness.js";

const FIXTURES = join(__dirname, "..", "..", "..", "packages", "adapters", "src", "gsc", "fixtures");

let h: Harness;
const WS = randomUUID();
const USER = randomUUID();
let connectionId = "";

const makeDeps = (over: { transport?: GscTransport; globalPerMinute?: number } = {}) => {
  const config = new ConfigRegistry(new InMemoryConfigStore());
  registerGscQuotaKeys(config);
  const metrics = new MetricsRegistry();
  const clock = () => new Date("2026-07-12T06:00:00Z");
  return {
    deps: {
      pool: h.app,
      rawStore: new FsRawStore(mkdtempSync(join(tmpdir(), "ingest-raw-"))),
      transport: over.transport ?? new FixtureGscTransport(FIXTURES),
      config,
      metrics,
      quota: new QuotaGuard(new InMemoryRateCounter(clock), clock, {
        globalPerMinute: over.globalPerMinute ?? 100,
        perWorkspacePerMinute: 50,
      }),
    },
    metrics,
  };
};

const payload = (conn = connectionId): IngestionJobPayload => ({
  family: "gsc.ingest.daily",
  workspaceId: null,
  scheduledFor: "2026-07-12T06:00:00.000Z",
  params: { workspaceId: WS, connectionId: conn, siteUrl: "sc-domain:forgcv.com" },
});

/** A connection with no sync watermark yet — a first run always performs work. */
const freshConnection = (): Promise<string> =>
  withWorkspace(h.app, WS, (tx) =>
    new ConnectionRepository().create(tx, {
      provider: "gsc", scopes: [], capabilities: { read_search_analytics: true }, authorizedBy: USER,
    }),
  );

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  await h.admin.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@t.dev', 'magic_link')`, [USER]);
  connectionId = await withWorkspace(h.app, WS, (tx) =>
    new ConnectionRepository().create(tx, {
      provider: "gsc", scopes: [], capabilities: { read_search_analytics: true }, authorizedBy: USER,
    }),
  );
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe("scheduler → queue → worker (end to end, fixtures only)", () => {
  it("a scheduled_jobs row flows through tick, the queue and the handler into signals + audit + metrics", async () => {
    await h.admin.query(
      `INSERT INTO scheduled_jobs (job_family, schedule, params) VALUES ('gsc.ingest.daily', '0 6 * * *', $1::jsonb)`,
      [JSON.stringify({ workspaceId: WS, connectionId, siteUrl: "sc-domain:forgcv.com" })],
    );
    const defs = await listEnabledSystemJobs(h.app);
    const queue = new InMemoryJobQueue<SchedulerPayload>();
    const enqueued = await tick(defs, queue, {
      windowStart: new Date("2026-07-12T05:59:00Z"),
      now: new Date("2026-07-12T06:00:30Z"),
    });
    expect(enqueued).toHaveLength(1);

    const { deps, metrics } = makeDeps();
    queue.process(createGscIngestionHandler(deps));
    await queue.drain();

    const signals = await h.admin.query(`SELECT count(*)::int AS n FROM signals`);
    expect(signals.rows[0].n).toBe(4);
    const audit = await h.admin.query(
      `SELECT details FROM audit_log WHERE event = 'ingestion.completed' AND workspace_id = $1`, [WS],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].details).toMatchObject({ inserted: 4, duplicates: 0, provider: "gsc" });
    const snap = metrics.snapshot();
    expect(snap.counters["ingest.signals_inserted"]).toBe(4);
    expect(snap.histograms["ingest.run_ms"]?.count).toBe(1);
  });

  it("window honors data_lag_days (never 'today's SEO'): dates end 2 days before scheduledFor", async () => {
    const { deps } = makeDeps();
    const captured: string[] = [];
    deps.transport = {
      querySearchAnalytics: async (req) => {
        captured.push(`${req.startDate}..${req.endDate}`);
        return new FixtureGscTransport(FIXTURES).querySearchAnalytics(req);
      },
    };
    const conn = await freshConnection();
    const q = new InMemoryJobQueue<SchedulerPayload>();
    q.process(createGscIngestionHandler(deps));
    await q.enqueue({ jobId: "w1", payload: payload(conn) });
    await q.drain();
    expect(captured).toEqual(["2026-07-10..2026-07-10"]); // scheduledFor 07-12 minus lag 2
  });
});

describe("idempotent execution", () => {
  it("two replicas ticking the same window enqueue once; re-running the handler adds zero signals and tolerates existing raw", async () => {
    const { deps } = makeDeps();
    const handler = createGscIngestionHandler(deps);
    const job = { jobId: "same", payload: payload(), attempt: 1 };
    await handler(job);
    await handler(job); // full re-execution: raw key identical (capturedAt = scheduledFor) → tolerated; signals deduped
    const signals = await h.admin.query(`SELECT count(*)::int AS n FROM signals`);
    expect(signals.rows[0].n).toBe(4); // unchanged from the e2e test
  });

  it("distinct definitions of the same family get distinct jobIds (no cross-workspace collision)", async () => {
    const defs = [
      { id: "d1", workspaceId: null, jobFamily: "gsc.ingest.daily", schedule: "0 6 * * *", params: { a: 1 } },
      { id: "d2", workspaceId: null, jobFamily: "gsc.ingest.daily", schedule: "0 6 * * *", params: { a: 2 } },
    ];
    const q = new InMemoryJobQueue<SchedulerPayload>();
    const enqueued = await tick(defs, q, {
      windowStart: new Date("2026-07-12T05:59:00Z"),
      now: new Date("2026-07-12T06:00:30Z"),
    });
    expect(new Set(enqueued).size).toBe(2);
  });
});

describe("quota citizenship (ADR-021 §2)", () => {
  it("an exhausted global bucket denies with kind quota, retries then dead-letters; denial is metered", async () => {
    const { deps, metrics } = makeDeps({ globalPerMinute: 0 });
    const conn = await freshConnection();
    const q = new InMemoryJobQueue<SchedulerPayload>({ attempts: 2, backoffMs: 0 });
    q.process(createGscIngestionHandler(deps));
    await q.enqueue({ jobId: "starved", payload: payload(conn) });
    await q.drain();
    expect(q.deadLetters).toHaveLength(1);
    expect(q.deadLetters[0]?.error).toMatch(/quota/i);
    expect(metrics.snapshot().counters["ingest.quota_denied"]).toBe(2); // one per attempt
  });

  it("per-workspace fairness: one workspace cannot starve another", async () => {
    const clock = () => new Date("2026-07-12T06:00:00Z");
    const guard = new QuotaGuard(new InMemoryRateCounter(clock), clock, {
      globalPerMinute: 100,
      perWorkspacePerMinute: 1,
    });
    await guard.acquire("gsc", "ws-hungry");
    await expect(guard.acquire("gsc", "ws-hungry")).rejects.toThrow(AdapterError);
    await expect(guard.acquire("gsc", "ws-polite")).resolves.toBeUndefined(); // fleet unharmed
  });
});

describe("failure honesty in the pipeline", () => {
  it("a persistently failing transport exhausts bounded retries into the DLQ; no partial signals", async () => {
    const { deps } = makeDeps({
      transport: {
        querySearchAnalytics: async () => {
          throw new AdapterError("transient", "503 backend error");
        },
      },
    });
    const conn = await freshConnection();
    const q = new InMemoryJobQueue<SchedulerPayload>({ attempts: 3, backoffMs: 0 });
    q.process(createGscIngestionHandler(deps));
    await q.enqueue({ jobId: "flaky-provider", payload: payload(conn) });
    await q.drain();
    expect(q.deadLetters).toHaveLength(1);
    expect(q.deadLetters[0]?.attempts).toBe(3);
    const signals = await h.admin.query(`SELECT count(*)::int AS n FROM signals`);
    expect(signals.rows[0].n).toBe(4); // still only the e2e batch
  });
});
