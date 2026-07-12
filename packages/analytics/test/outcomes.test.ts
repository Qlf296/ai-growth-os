/** STEP 8.1 — outcome measurement: verdicts from measured values, evidence (I4), idempotent, RLS, honest unmeasurable. */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withWorkspace } from "@aigos/database";

import { recordOutcome, verdictFor } from "../src/index.js";
import { startHarness, seedWorkspace, type Harness } from "../../database/test/harness.js";

let h: Harness;
const WS = randomUUID();
const OTHER = randomUUID();
const SUBJECT = randomUUID();

beforeAll(async () => { h = await startHarness(); await seedWorkspace(h.admin, WS, "ws"); await seedWorkspace(h.admin, OTHER, "o"); }, 120_000);
afterAll(async () => { await h.stop(); });

describe("verdictFor (deterministic, measured units only)", () => {
  it("met / partial / not_met / unmeasurable", () => {
    expect(verdictFor({ subjectType: "opportunity", subjectId: "s", metric: "ctr", baselineValue: 0.02, observedValue: 0.025, windowDays: 28, targetImprovement: 0.1 }).verdict).toBe("met");
    expect(verdictFor({ subjectType: "opportunity", subjectId: "s", metric: "ctr", baselineValue: 0.02, observedValue: 0.021, windowDays: 28, targetImprovement: 0.1 }).verdict).toBe("partial");
    expect(verdictFor({ subjectType: "opportunity", subjectId: "s", metric: "ctr", baselineValue: 0.02, observedValue: 0.018, windowDays: 28, targetImprovement: 0.1 }).verdict).toBe("not_met");
    expect(verdictFor({ subjectType: "opportunity", subjectId: "s", metric: "ctr", baselineValue: null, observedValue: 0.02, windowDays: 28, targetImprovement: 0.1 }).verdict).toBe("unmeasurable");
  });
});

describe("recordOutcome", () => {
  it("persists an evidence-backed outcome; evidence carries measured, unmonetized data (Law 15/I4)", async () => {
    const r = await recordOutcome(h.app, WS, { subjectType: "opportunity", subjectId: SUBJECT, metric: "ctr", baselineValue: 0.02, observedValue: 0.03, windowDays: 28, targetImprovement: 0.1 });
    expect(r.verdict).toBe("met");
    expect(r.evidenceReferenceId).toMatch(/^[0-9a-f-]{36}$/);
    const ev = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT data FROM evidence WHERE id = $1`, [r.evidenceReferenceId]));
    expect(ev.rows[0].data).toMatchObject({ monetized: false, unit: "measured", verdict: "met" });
    const oe = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT verdict, evidence_id FROM outcome_evaluations WHERE subject_id = $1`, [SUBJECT]));
    expect(oe.rows[0].verdict).toBe("met");
    expect(oe.rows[0].evidence_id).toBe(r.evidenceReferenceId); // I4 link
  });

  it("is idempotent per (subject, metric, window)", async () => {
    await recordOutcome(h.app, WS, { subjectType: "opportunity", subjectId: SUBJECT, metric: "ctr", baselineValue: 0.02, observedValue: 0.03, windowDays: 28, targetImprovement: 0.1 });
    const n = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n FROM outcome_evaluations WHERE subject_id = $1`, [SUBJECT]));
    expect(n.rows[0].n).toBe(1);
  });

  it("RLS: another workspace sees no outcomes", async () => {
    expect((await withWorkspace(h.app, OTHER, (tx) => tx.query(`SELECT * FROM outcome_evaluations`))).rowCount).toBe(0);
  });
});
