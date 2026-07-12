/**
 * Phase 2.7 — production-ready incremental GSC synchronization.
 * Watermark-driven incremental window, pagination, resume-after-failure,
 * idempotency, sync metadata, health, next-run scheduling. Fixtures only.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AdapterError,
  InMemoryRateCounter,
  QuotaGuard,
  type GscSearchAnalyticsRequest,
  type GscTransport,
} from "@aigos/adapters";
import { ConfigRegistry, InMemoryConfigStore } from "@aigos/config-registry";
import { ConnectionRepository, getSyncState, scheduleWorkspaceJob, withWorkspace } from "@aigos/database";
import { FsRawStore, InMemoryJobQueue, MetricsRegistry } from "@aigos/infra";

import { createGscIngestionHandler, registerGscQuotaKeys, type IngestionJobPayload } from "../src/ingestion.js";
import type { SchedulerPayload } from "../src/scheduler.js";
import { startHarness, seedWorkspace, type Harness } from "../../../packages/database/test/harness.js";

let h: Harness;
const WS = randomUUID();
const USER = randomUUID();
let connectionId = "";

/** Deterministic transport: N rows per day, one page (rows < rowLimit). */
class DayTransport implements GscTransport {
  calls: string[] = [];
  fail = false;
  listSites() { return Promise.resolve({ siteEntry: [] }); }
  querySearchAnalytics(req: GscSearchAnalyticsRequest): Promise<unknown> {
    if (this.fail) throw new AdapterError("transient", "503");
    this.calls.push(`${req.startDate}#${req.startRow ?? 0}`);
    if ((req.startRow ?? 0) > 0) return Promise.resolve({ rows: [] });
    return Promise.resolve({
      rows: [
        { keys: [req.startDate, `q-${req.startDate}`, `https://forgcv.com/${req.startDate}`], clicks: 1, impressions: 10, ctr: 0.1, position: 5 },
      ],
    });
  }
}

const deps = (transport: GscTransport, globalPerMinute = 1000) => {
  const config = new ConfigRegistry(new InMemoryConfigStore());
  registerGscQuotaKeys(config);
  const metrics = new MetricsRegistry();
  const clock = () => new Date("2026-07-12T06:00:00Z");
  return {
    d: {
      pool: h.app,
      rawStore: new FsRawStore(mkdtempSync(join(tmpdir(), "sync-raw-"))),
      transport,
      config,
      metrics,
      quota: new QuotaGuard(new InMemoryRateCounter(clock), clock, { globalPerMinute, perWorkspacePerMinute: 500 }),
    },
    metrics,
  };
};

const payload = (scheduledFor: string): IngestionJobPayload => ({
  family: "gsc.ingest.daily",
  workspaceId: null,
  scheduledFor,
  params: { workspaceId: WS, connectionId, siteUrl: "sc-domain:forgcv.com" },
});

const run = async (handlerDeps: Parameters<typeof createGscIngestionHandler>[0], scheduledFor: string) => {
  const q = new InMemoryJobQueue<SchedulerPayload>({ attempts: 1, backoffMs: 0 });
  q.process(createGscIngestionHandler(handlerDeps));
  await q.enqueue({ jobId: `job-${scheduledFor}`, payload: payload(scheduledFor) });
  await q.drain();
  return q;
};

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  await h.admin.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@t.dev', 'magic_link')`, [USER]);
  connectionId = await withWorkspace(h.app, WS, (tx) =>
    new ConnectionRepository().create(tx, { provider: "gsc", scopes: [], capabilities: { read_search_analytics: true }, authorizedBy: USER }),
  );
  await scheduleWorkspaceJob(h.app, {
    workspaceId: WS, jobFamily: "gsc.ingest.daily", schedule: "0 6 * * *",
    params: { workspaceId: WS, connectionId, siteUrl: "sc-domain:forgcv.com" },
  });
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe("first run establishes the watermark and metadata", () => {
  it("syncs the lagged target day, records sync state, health and next run", async () => {
    const { d } = deps(new DayTransport());
    await run(d, "2026-07-12T06:00:00Z"); // lag 2 → target 2026-07-10
    const signals = await h.admin.query(`SELECT count(*)::int AS n FROM signals`);
    expect(signals.rows[0].n).toBe(1);
    const state = (await getSyncState(h.app, WS, connectionId))!;
    expect(state.lastSuccessfulSync?.toISOString().slice(0, 10)).toBe("2026-07-10");
    expect(state.lastAttemptedSync).not.toBeNull();
    expect(state.importedRows).toBe(1);
    expect(state.apiQuotaUsed).toBeGreaterThanOrEqual(1);
    expect(state.lastError).toBeNull();
    expect(state.lastDurationMs).not.toBeNull();
    const conn = await h.admin.query(`SELECT health_checked_at FROM connections WHERE id = $1`, [connectionId]);
    expect(conn.rows[0].health_checked_at).not.toBeNull();
    const job = await h.admin.query(
      `SELECT last_status, next_run_at, last_run_at FROM scheduled_jobs WHERE workspace_id = $1 AND job_family = 'gsc.ingest.daily'`, [WS],
    );
    expect(job.rows[0].last_status).toBe("ok");
    expect(job.rows[0].next_run_at).not.toBeNull();
  });
});

describe("incremental window advances by the watermark", () => {
  it("a later run syncs only the newly available days", async () => {
    const transport = new DayTransport();
    const { d } = deps(transport);
    await run(d, "2026-07-14T06:00:00Z"); // target 2026-07-12; watermark was 07-10 → syncs 07-11, 07-12
    expect(transport.calls.map((c) => c.split("#")[0])).toEqual(["2026-07-11", "2026-07-12"]);
    const state = (await getSyncState(h.app, WS, connectionId))!;
    expect(state.lastSuccessfulSync?.toISOString().slice(0, 10)).toBe("2026-07-12");
    expect(state.importedRows).toBe(3); // 1 (first run) + 2 new days
  });

  it("re-running with no new days is a no-op (up_to_date), adds zero signals", async () => {
    const before = (await h.admin.query(`SELECT count(*)::int AS n FROM signals`)).rows[0].n;
    const { d, metrics } = deps(new DayTransport());
    await run(d, "2026-07-14T06:00:00Z");
    expect(metrics.snapshot().counters["ingest.up_to_date"]).toBe(1);
    const after = (await h.admin.query(`SELECT count(*)::int AS n FROM signals`)).rows[0].n;
    expect(after).toBe(before);
  });
});

describe("resume after interruption without data loss", () => {
  it("a failed run leaves the watermark untouched and records the error; the retry completes idempotently", async () => {
    const failing = new DayTransport();
    failing.fail = true;
    const { d } = deps(failing);
    await run(d, "2026-07-16T06:00:00Z"); // target 07-14; would sync 07-13, 07-14
    let state = (await getSyncState(h.app, WS, connectionId))!;
    expect(state.lastSuccessfulSync?.toISOString().slice(0, 10)).toBe("2026-07-12"); // unchanged
    expect(state.lastError).toMatch(/503/);
    const signalsAfterFail = (await h.admin.query(`SELECT count(*)::int AS n FROM signals`)).rows[0].n;
    expect(signalsAfterFail).toBe(3); // nothing partial leaked

    const { d: d2 } = deps(new DayTransport());
    await run(d2, "2026-07-16T06:00:00Z");
    state = (await getSyncState(h.app, WS, connectionId))!;
    expect(state.lastSuccessfulSync?.toISOString().slice(0, 10)).toBe("2026-07-14");
    expect(state.lastError).toBeNull();
    expect((await h.admin.query(`SELECT count(*)::int AS n FROM signals`)).rows[0].n).toBe(5); // +07-13, +07-14
  });

  it("running the very same completed window again inserts no duplicate signals (idempotent)", async () => {
    const before = (await h.admin.query(`SELECT count(*)::int AS n FROM signals`)).rows[0].n;
    const { d } = deps(new DayTransport());
    await run(d, "2026-07-16T06:00:00Z");
    expect((await h.admin.query(`SELECT count(*)::int AS n FROM signals`)).rows[0].n).toBe(before);
  });
});

describe("quota citizenship still holds", () => {
  it("an exhausted bucket dead-letters and records the error on sync state", async () => {
    const fresh = randomUUID();
    const conn = await withWorkspace(h.app, WS, (tx) =>
      new ConnectionRepository().create(tx, { provider: "gsc", scopes: [], capabilities: {}, authorizedBy: USER }),
    );
    const { d, metrics } = deps(new DayTransport(), 0);
    const q = new InMemoryJobQueue<SchedulerPayload>({ attempts: 2, backoffMs: 0 });
    q.process(createGscIngestionHandler(d));
    await q.enqueue({ jobId: `q-${fresh}`, payload: { ...payload("2026-07-12T06:00:00Z"), params: { workspaceId: WS, connectionId: conn, siteUrl: "sc-domain:forgcv.com" } } });
    await q.drain();
    expect(q.deadLetters).toHaveLength(1);
    expect(metrics.snapshot().counters["ingest.quota_denied"]).toBe(2);
    const state = (await getSyncState(h.app, WS, conn))!;
    expect(state.lastError).toMatch(/quota/i);
    expect(state.lastSuccessfulSync).toBeNull();
  });
});
