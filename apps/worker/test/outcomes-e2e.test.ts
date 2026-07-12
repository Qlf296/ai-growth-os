/** STEP 9.2 — outcome evaluation scheduler: delayed, idempotent, duplicate-prevented, retry-safe. */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { snapshotBaseline, withWorkspace } from "@aigos/database";
import { InMemoryJobQueue, MetricsRegistry } from "@aigos/infra";

import { createOutcomesHandler, pendingEvaluations } from "../src/outcomes.js";
import type { SchedulerPayload } from "../src/scheduler.js";
import { startHarness, seedWorkspace, type Harness } from "../../../packages/database/test/harness.js";

let h: Harness;
const WS = randomUUID();
let completedOld = "";
let completedRecent = "";

async function makeOpportunity(status: string, updatedDaysAgo: number): Promise<string> {
  const id = randomUUID();
  await withWorkspace(h.app, WS, (tx) => tx.query(
    `INSERT INTO opportunities (id, workspace_id, entity, category, detectors, severity, confidence, impact, difficulty, effort, roi, priority_score, score_trace, evidence_ids, occurred_on, dedupe_hash, status, updated_at)
     VALUES ($1, NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'e', 'seo', '[]'::jsonb, 'low', 'medium', 'medium', 'low', 'low', '{}'::jsonb, 0.5, '{}'::jsonb, '[]'::jsonb, '2026-07-12', $2, $3, now() - ($4 || ' days')::interval)`,
    [id, randomUUID(), status, updatedDaysAgo],
  ));
  return id;
}

const NOW = new Date("2026-07-12T07:00:00Z");
const observe = async (): Promise<number> => 0.03; // met vs 0.02 baseline

const runScheduled = async () => {
  const q = new InMemoryJobQueue<SchedulerPayload>({ attempts: 2, backoffMs: 0 });
  const metrics = new MetricsRegistry();
  q.process(createOutcomesHandler({ pool: h.app, metrics, observe }));
  await q.enqueue({ jobId: "o1", payload: { family: "outcomes.evaluate", workspaceId: null, scheduledFor: NOW.toISOString(), params: { workspaceId: WS, metric: "ctr", windowDays: 28 } } });
  await q.drain();
  return { q, metrics };
};

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  completedOld = await makeOpportunity("completed", 30);     // eligible (>28d)
  completedRecent = await makeOpportunity("completed", 5);   // not yet eligible
  await makeOpportunity("accepted", 40);                     // not completed → excluded
  for (const id of [completedOld, completedRecent]) await snapshotBaseline(h.app, WS, { opportunityId: id, metric: "ctr", baselineValue: 0.02, windowDays: 28 });
}, 120_000);

afterAll(async () => { await h.stop(); });

describe("outcome evaluation scheduler", () => {
  it("evaluates only opportunities completed at least windowDays ago (delayed evaluation)", async () => {
    const pending = await pendingEvaluations(h.app, WS, "ctr", 28, NOW);
    expect(pending).toContain(completedOld);
    expect(pending).not.toContain(completedRecent);
  });

  it("scheduler measures + grades + stores the outcome once", async () => {
    const { metrics } = await runScheduled();
    expect(metrics.snapshot().counters["outcomes.evaluated"]).toBe(1);
    const oe = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT verdict, grade, evidence_id FROM outcome_evaluations WHERE subject_id = $1 AND metric = 'ctr'`, [completedOld]));
    expect(oe.rows[0].verdict).toBe("met");
    expect(oe.rows[0].grade).toBeTruthy();
    expect(oe.rows[0].evidence_id).toBeTruthy(); // I4
  });

  it("is idempotent: a second scheduled run creates no duplicate (duplicate prevention)", async () => {
    await runScheduled();
    const n = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n FROM outcome_evaluations WHERE subject_id = $1 AND metric = 'ctr'`, [completedOld]));
    expect(n.rows[0].n).toBe(1);
  });

  it("retry-safe: bounded attempts, no double evaluation", async () => {
    const q = new InMemoryJobQueue<SchedulerPayload>({ attempts: 3, backoffMs: 0 });
    q.process(createOutcomesHandler({ pool: h.app, metrics: new MetricsRegistry(), observe }));
    await q.enqueue({ jobId: "o2", payload: { family: "outcomes.evaluate", workspaceId: null, scheduledFor: NOW.toISOString(), params: { workspaceId: WS, metric: "ctr", windowDays: 28 } } });
    await q.drain();
    expect(q.deadLetters).toHaveLength(0);
    const n = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n FROM outcome_evaluations WHERE subject_id = $1`, [completedOld]));
    expect(n.rows[0].n).toBe(1);
  });
});
