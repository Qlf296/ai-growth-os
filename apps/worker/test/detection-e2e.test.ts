/**
 * Phase 3 STEP 3.5/3.6 — detection scheduler end-to-end:
 * schedule → tick → queue → detection handler → evidence + findings + runs,
 * with replay determinism, retry, dedup and RLS. Uses seeded normalized signals.
 */
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConnectionRepository, SignalRepository, scheduleWorkspaceJob, withWorkspace } from "@aigos/database";
import { InMemoryJobQueue, MetricsRegistry } from "@aigos/infra";

import { createDetectionHandler } from "../src/detection.js";
import { tick, type JobDefinition, type SchedulerPayload } from "../src/scheduler.js";
import { startHarness, seedWorkspace, type Harness } from "../../../packages/database/test/harness.js";

void join;

let h: Harness;
const WS = randomUUID();
const OTHER = randomUUID();
const USER = randomUUID();
let connectionId = "";
const NOW = "2026-06-15T07:00:00Z";

async function seed(page: string, date: string, o: { clicks: number; impressions: number; position: number }): Promise<void> {
  const externalId = `${date}|q|${page}`;
  await withWorkspace(h.app, WS, (tx) =>
    new SignalRepository().insertMany(tx, [{
      connectionId, source: "gsc", type: "gsc.search_analytics.daily", externalId,
      occurredAt: new Date(`${date}T00:00:00Z`), payloadRef: `${WS}/gsc/${date}/x`,
      data: { page, query: "q", clicks: o.clicks, impressions: o.impressions, ctr: o.impressions ? o.clicks / o.impressions : 0, position: o.position },
      normalizerVersion: 1, dedupeHash: createHash("sha256").update(`gsc|daily|${externalId}`).digest("hex"),
    }]),
  );
}

const runScheduled = async () => {
  const row = await h.admin.query(`SELECT id, params FROM scheduled_jobs WHERE workspace_id = $1 AND job_family = 'detection.run'`, [WS]);
  const def: JobDefinition = { id: row.rows[0].id, workspaceId: WS, jobFamily: "detection.run", schedule: "0 7 * * *", params: row.rows[0].params };
  const q = new InMemoryJobQueue<SchedulerPayload>({ attempts: 2, backoffMs: 0 });
  const metrics = new MetricsRegistry();
  await tick([def], q, { windowStart: new Date(new Date(NOW).getTime() - 120_000), now: new Date(new Date(NOW).getTime() + 60_000) });
  q.process(createDetectionHandler({ pool: h.app, metrics, windowDays: 7 }));
  await q.drain();
  return { q, metrics };
};

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  await seedWorkspace(h.admin, OTHER, "other");
  await h.admin.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@t.dev', 'magic_link')`, [USER]);
  connectionId = await withWorkspace(h.app, WS, (tx) => new ConnectionRepository().create(tx, { provider: "gsc", scopes: [], capabilities: {}, authorizedBy: USER }));
  for (const d of ["2026-06-09", "2026-06-11", "2026-06-13"]) await seed("https://forgcv.com/cv", d, { clicks: 5, impressions: 400, position: 14 });
  await scheduleWorkspaceJob(h.app, { workspaceId: WS, jobFamily: "detection.run", schedule: "0 7 * * *", params: { workspaceId: WS } });
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe("detection scheduler e2e", () => {
  it("tick → queue → handler produces evidence-backed findings and run history", async () => {
    const { q, metrics } = await runScheduled();
    expect(q.deadLetters).toHaveLength(0);
    const findings = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT detector, evidence_id FROM detector_findings`));
    expect(findings.rowCount).toBeGreaterThan(0);
    expect(findings.rows.every((r: { evidence_id: string | null }) => r.evidence_id)).toBe(true); // I4
    expect(metrics.snapshot().counters["detection.findings_total"]).toBe(findings.rowCount);
    const runs = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n FROM detector_runs WHERE status = 'ok'`));
    expect(runs.rows[0].n).toBeGreaterThanOrEqual(4);
  });

  it("replay: re-running the schedule adds no new findings (determinism + dedup)", async () => {
    const before = (await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n FROM detector_findings`))).rows[0].n;
    await runScheduled();
    const after = (await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n FROM detector_findings`))).rows[0].n;
    expect(after).toBe(before);
  });

  it("RLS isolation holds for detection output", async () => {
    expect((await withWorkspace(h.app, OTHER, (tx) => tx.query(`SELECT * FROM detector_findings`))).rowCount).toBe(0);
  });
});
