/** STEP 7.5 — experiment evaluation: winner detection, promotion vs rollback, deterministic replay. */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createExperiment, evaluateExperiment, recordMetric } from "../src/index.js";
import { startHarness, seedWorkspace, type Harness } from "../../database/test/harness.js";

let h: Harness;
const WS = randomUUID();

beforeAll(async () => { h = await startHarness(); await seedWorkspace(h.admin, WS, "ws"); }, 120_000);
afterAll(async () => { await h.stop(); });

const make = async () => createExperiment(h.app, WS, { hypothesis: "h", expectedImpact: "i", confidence: "medium", metric: "ctr", variants: [{ label: "control" }, { label: "treatment" }] });

describe("evaluateExperiment", () => {
  it("treatment wins → promotion; experiment completed with the winner", async () => {
    const e = await make();
    const control = e.variants.find((v) => v.label === "control")!;
    const treatment = e.variants.find((v) => v.label === "treatment")!;
    await recordMetric(h.app, WS, e.id, control.id, "ctr", 0.02);
    await recordMetric(h.app, WS, e.id, treatment.id, "ctr", 0.05);
    const r = await evaluateExperiment(h.app, WS, e.id);
    expect(r.winnerLabel).toBe("treatment");
    expect(r.outcome).toBe("promotion");
    const row = await h.admin.query(`SELECT status, winner_variant_id FROM experiments WHERE id = $1`, [e.id]);
    expect(row.rows[0].status).toBe("completed");
    expect(row.rows[0].winner_variant_id).toBe(treatment.id);
  });

  it("control wins → rollback", async () => {
    const e = await make();
    const control = e.variants.find((v) => v.label === "control")!;
    const treatment = e.variants.find((v) => v.label === "treatment")!;
    await recordMetric(h.app, WS, e.id, control.id, "ctr", 0.06);
    await recordMetric(h.app, WS, e.id, treatment.id, "ctr", 0.03);
    const r = await evaluateExperiment(h.app, WS, e.id);
    expect(r.winnerLabel).toBe("control");
    expect(r.outcome).toBe("rollback");
  });

  it("a tie resolves to control (conservative rollback)", async () => {
    const e = await make();
    const control = e.variants.find((v) => v.label === "control")!;
    const treatment = e.variants.find((v) => v.label === "treatment")!;
    await recordMetric(h.app, WS, e.id, control.id, "ctr", 0.04);
    await recordMetric(h.app, WS, e.id, treatment.id, "ctr", 0.04);
    const r = await evaluateExperiment(h.app, WS, e.id);
    expect(r.winnerLabel).toBe("control");
    expect(r.outcome).toBe("rollback");
  });

  it("evaluation is audited and reproducible over stored metrics", async () => {
    const e = await make();
    const treatment = e.variants.find((v) => v.label === "treatment")!;
    await recordMetric(h.app, WS, e.id, treatment.id, "ctr", 0.09);
    const first = await evaluateExperiment(h.app, WS, e.id);
    const second = await evaluateExperiment(h.app, WS, e.id); // completed already; means identical
    expect(second.winnerVariantId).toBe(first.winnerVariantId);
    const audit = await h.admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE event = 'experiment.evaluated' AND details->>'experimentId' = $1`, [e.id]);
    expect(audit.rows[0].n).toBe(2);
  });
});
