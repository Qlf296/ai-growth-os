/** STEP 9.1 — immutable opportunity baselines: once, immutable, deterministic, RLS, replay-safe. */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { baselineHash, getBaseline, snapshotBaseline } from "../src/index.js";
import { withWorkspace } from "../src/tenancy.js";
import { startHarness, seedWorkspace, type Harness } from "./harness.js";

let h: Harness;
const WS = randomUUID();
const OTHER = randomUUID();
const USER = randomUUID();
let opportunityId = "";

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  await seedWorkspace(h.admin, OTHER, "o");
  await h.admin.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@t.dev', 'magic_link')`, [USER]);
  opportunityId = (await withWorkspace(h.app, WS, (tx) => tx.query(
    `INSERT INTO opportunities (workspace_id, entity, category, detectors, severity, confidence, impact, difficulty, effort, roi, priority_score, score_trace, evidence_ids, occurred_on, dedupe_hash)
     VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'e', 'seo', '[]'::jsonb, 'low', 'medium', 'medium', 'low', 'low', '{}'::jsonb, 0.5, '{}'::jsonb, '[]'::jsonb, '2026-07-12', $1) RETURNING id`,
    [randomUUID()],
  ))).rows[0].id;
}, 120_000);

afterAll(async () => { await h.stop(); });

describe("snapshotBaseline", () => {
  it("deterministic hash for identical content", () => {
    const a = baselineHash({ opportunityId, metric: "ctr", baselineValue: 0.02, windowDays: 28 });
    const b = baselineHash({ opportunityId, metric: "ctr", baselineValue: 0.02, windowDays: 28 });
    expect(a).toBe(b);
    expect(baselineHash({ opportunityId, metric: "ctr", baselineValue: 0.03, windowDays: 28 })).not.toBe(a);
  });

  it("snapshots once and is immutable: a second call with a different value keeps the first", async () => {
    const first = await snapshotBaseline(h.app, WS, { opportunityId, metric: "ctr", baselineValue: 0.02, windowDays: 28 });
    const second = await snapshotBaseline(h.app, WS, { opportunityId, metric: "ctr", baselineValue: 0.99, windowDays: 28 });
    expect(second.baselineValue).toBe(0.02); // unchanged
    expect(second.id).toBe(first.id);
    const n = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n FROM opportunity_baselines WHERE opportunity_id = $1`, [opportunityId]));
    expect(n.rows[0].n).toBe(1);
  });

  it("getBaseline returns the stored snapshot; replay is safe (same hash)", async () => {
    const b = await getBaseline(h.app, WS, opportunityId, "ctr");
    expect(b?.baselineValue).toBe(0.02);
    expect(b?.snapshotHash).toBe(baselineHash({ opportunityId, metric: "ctr", baselineValue: 0.02, windowDays: 28 }));
  });

  it("app role cannot UPDATE or DELETE a baseline (write-once by grant)", async () => {
    await expect(h.app.query(`UPDATE opportunity_baselines SET baseline_value = 1`)).rejects.toThrow(/permission denied/);
    await expect(h.app.query(`DELETE FROM opportunity_baselines`)).rejects.toThrow(/permission denied/);
  });

  it("RLS: another workspace sees no baselines", async () => {
    expect((await withWorkspace(h.app, OTHER, (tx) => tx.query(`SELECT * FROM opportunity_baselines`))).rowCount).toBe(0);
  });
});
