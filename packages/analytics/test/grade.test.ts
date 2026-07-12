/** STEP 8.2 — attribution grading (ADR-033) and learning weights. */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withWorkspace } from "@aigos/database";

import { LEARNING_WEIGHT, gradeOutcome, recordOutcome } from "../src/index.js";
import { startHarness, seedWorkspace, type Harness } from "../../database/test/harness.js";

let h: Harness;
const WS = randomUUID();

beforeAll(async () => { h = await startHarness(); await seedWorkspace(h.admin, WS, "ws"); }, 120_000);
afterAll(async () => { await h.stop(); });

describe("gradeOutcome (ADR-033 rule)", () => {
  it("A = UTM-keyed page-scoped, no confounders; B+ = UTM with confounders", () => {
    expect(gradeOutcome({ pageScoped: true, utmKeyed: true, confounders: 0 }, "met")).toBe("A");
    expect(gradeOutcome({ pageScoped: true, utmKeyed: true, confounders: 1 }, "met")).toBe("B+");
  });
  it("B = scoped GSC correlation; C = scoped with confounders; F = broad or unmeasurable", () => {
    expect(gradeOutcome({ pageScoped: true, utmKeyed: false, confounders: 0 }, "met")).toBe("B");
    expect(gradeOutcome({ pageScoped: true, utmKeyed: false, confounders: 2 }, "met")).toBe("C");
    expect(gradeOutcome({ pageScoped: false, utmKeyed: false, confounders: 0 }, "met")).toBe("F");
    expect(gradeOutcome({ pageScoped: true, utmKeyed: true, confounders: 0 }, "unmeasurable")).toBe("F");
  });
  it("learning weights follow the grade (A full → F zero)", () => {
    expect(LEARNING_WEIGHT.A).toBe(1.0);
    expect(LEARNING_WEIGHT["B+"]).toBeLessThan(LEARNING_WEIGHT.A);
    expect(LEARNING_WEIGHT.B).toBeLessThan(LEARNING_WEIGHT["B+"]);
    expect(LEARNING_WEIGHT.C).toBeLessThan(LEARNING_WEIGHT.B);
    expect(LEARNING_WEIGHT.F).toBe(0);
  });
});

describe("recordOutcome persists the grade", () => {
  it("default attribution grades a met scoped result as B; evidence carries the grade", async () => {
    const subject = randomUUID();
    const r = await recordOutcome(h.app, WS, { subjectType: "opportunity", subjectId: subject, metric: "ctr", baselineValue: 0.02, observedValue: 0.03, windowDays: 28, targetImprovement: 0.1 });
    expect(r.grade).toBe("B");
    const row = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT grade FROM outcome_evaluations WHERE subject_id = $1`, [subject]));
    expect(row.rows[0].grade).toBe("B");
    const ev = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT data FROM evidence WHERE id = $1`, [r.evidenceReferenceId]));
    expect(ev.rows[0].data).toMatchObject({ grade: "B" });
  });

  it("an unmeasurable outcome is graded F", async () => {
    const subject = randomUUID();
    const r = await recordOutcome(h.app, WS, { subjectType: "opportunity", subjectId: subject, metric: "ctr", baselineValue: null, observedValue: 0.03, windowDays: 28, targetImprovement: 0.1 });
    expect(r.verdict).toBe("unmeasurable");
    expect(r.grade).toBe("F");
  });
});
