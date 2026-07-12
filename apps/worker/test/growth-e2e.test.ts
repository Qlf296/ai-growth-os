/**
 * Phase 4 STEP 4.6 — full workflow e2e: signals → detection → growth build →
 * daily feed, deterministic and idempotent, on the existing scheduler/queue.
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConfigRegistry, InMemoryConfigStore } from "@aigos/config-registry";
import { ConnectionRepository, SignalRepository, scheduleWorkspaceJob, withWorkspace } from "@aigos/database";
import { buildFeed, registerGrowthWeights } from "@aigos/growth";
import { InMemoryJobQueue, MetricsRegistry } from "@aigos/infra";

import { createDetectionHandler } from "../src/detection.js";
import { createGrowthHandler } from "../src/growth.js";
import { tick, type JobDefinition, type SchedulerPayload } from "../src/scheduler.js";
import { startHarness, seedWorkspace, type Harness } from "../../../packages/database/test/harness.js";

let h: Harness;
let config: ConfigRegistry;
const WS = randomUUID();
const OTHER = randomUUID();
const USER = randomUUID();
let connectionId = "";
const NOW = "2026-06-15T07:00:00Z";
const DAY = "2026-06-15";

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

const runJob = async (family: string, handler: (job: { jobId: string; payload: SchedulerPayload }) => Promise<void>) => {
  const row = await h.admin.query(`SELECT id, params FROM scheduled_jobs WHERE workspace_id = $1 AND job_family = $2`, [WS, family]);
  const def: JobDefinition = { id: row.rows[0].id, workspaceId: WS, jobFamily: family, schedule: "0 7 * * *", params: row.rows[0].params };
  const q = new InMemoryJobQueue<SchedulerPayload>({ attempts: 2, backoffMs: 0 });
  await tick([def], q, { windowStart: new Date(new Date(NOW).getTime() - 120_000), now: new Date(new Date(NOW).getTime() + 60_000) });
  q.process(handler);
  await q.drain();
  return q;
};

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  await seedWorkspace(h.admin, OTHER, "other");
  await h.admin.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@t.dev', 'magic_link')`, [USER]);
  config = new ConfigRegistry(new InMemoryConfigStore());
  registerGrowthWeights(config);
  connectionId = await withWorkspace(h.app, WS, (tx) => new ConnectionRepository().create(tx, { provider: "gsc", scopes: [], capabilities: {}, authorizedBy: USER }));
  for (const d of ["2026-06-09", "2026-06-11", "2026-06-13"]) await seed("https://forgcv.com/cv", d, { clicks: 5, impressions: 400, position: 14 });
  await scheduleWorkspaceJob(h.app, { workspaceId: WS, jobFamily: "detection.run", schedule: "0 7 * * *", params: { workspaceId: WS } });
  await scheduleWorkspaceJob(h.app, { workspaceId: WS, jobFamily: "growth.build", schedule: "0 7 * * *", params: { workspaceId: WS } });
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe("signals → detection → growth → feed", () => {
  it("produces an evidence-backed, recommended, ranked feed item", async () => {
    const detQ = await runJob("detection.run", createDetectionHandler({ pool: h.app, metrics: new MetricsRegistry(), windowDays: 7 }));
    expect(detQ.deadLetters).toHaveLength(0);
    const growthQ = await runJob("growth.build", createGrowthHandler({ pool: h.app, config, metrics: new MetricsRegistry() }));
    expect(growthQ.deadLetters).toHaveLength(0);

    const feed = await buildFeed(h.app, WS, DAY, { pageSize: 3 });
    expect(feed.total).toBeGreaterThan(0);
    const item = feed.items[0]!;
    expect(item.entity.endsWith("/cv")).toBe(true);
    expect(item.recommendation).not.toBeNull();
    expect(item.priorityScore).toBeGreaterThan(0);

    // every opportunity references evidence (I4)
    const opps = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT evidence_ids FROM opportunities`));
    expect(opps.rows.every((r: { evidence_ids: unknown[] }) => r.evidence_ids.length > 0)).toBe(true);
  });

  it("replay: re-running detection + growth yields the same feed, no duplicates", async () => {
    const before = await buildFeed(h.app, WS, DAY, { pageSize: 10 });
    await runJob("detection.run", createDetectionHandler({ pool: h.app, metrics: new MetricsRegistry(), windowDays: 7 }));
    await runJob("growth.build", createGrowthHandler({ pool: h.app, config, metrics: new MetricsRegistry() }));
    const after = await buildFeed(h.app, WS, DAY, { pageSize: 10 });
    expect(after.total).toBe(before.total);
    expect(after.items.map((i) => i.opportunityId)).toEqual(before.items.map((i) => i.opportunityId));
  });

  it("RLS: another workspace has an empty feed", async () => {
    const feed = await buildFeed(h.app, OTHER, DAY, { pageSize: 10 });
    expect(feed.total).toBe(0);
  });
});
