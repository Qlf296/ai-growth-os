/** STEP 7.2 — experiment lifecycle, variants, deterministic assignments, metrics on real Postgres. */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withWorkspace } from "@aigos/database";

import { assignVariant, createExperiment, recordMetric, transitionExperiment } from "../src/index.js";
import { startHarness, seedWorkspace, type Harness } from "../../database/test/harness.js";

let h: Harness;
const WS = randomUUID();
const OTHER = randomUUID();

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  await seedWorkspace(h.admin, OTHER, "other");
}, 120_000);

afterAll(async () => { await h.stop(); });

describe("experiment lifecycle + variants", () => {
  it("creates a running experiment with variants; needs ≥2 variants", async () => {
    await expect(createExperiment(h.app, WS, { hypothesis: "h", expectedImpact: "clicks", confidence: "medium", metric: "ctr", variants: [{ label: "control" }] })).rejects.toThrow(/two variants/);
    const e = await createExperiment(h.app, WS, { hypothesis: "Rewriting the title lifts CTR", expectedImpact: "+10% clicks", confidence: "medium", metric: "ctr", variants: [{ label: "control" }, { label: "treatment", payload: { title: "new" } }] });
    expect(e.status).toBe("running");
    expect(e.variants.map((v) => v.label).sort()).toEqual(["control", "treatment"]);
  });

  it("assignment is deterministic and stable per unit", async () => {
    const e = await createExperiment(h.app, WS, { hypothesis: "h", expectedImpact: "i", confidence: "low", metric: "ctr", variants: [{ label: "a" }, { label: "b" }] });
    const first = await assignVariant(h.app, WS, e.id, "https://forgcv.com/cv");
    const again = await assignVariant(h.app, WS, e.id, "https://forgcv.com/cv");
    expect(again).toBe(first); // stable
    const rows = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n FROM experiment_assignments WHERE experiment_id = $1 AND unit = $2`, [e.id, "https://forgcv.com/cv"]));
    expect(rows.rows[0].n).toBe(1); // persisted once
  });

  it("records metrics and transitions running → completed (winner) → archived, audited", async () => {
    const e = await createExperiment(h.app, WS, { hypothesis: "h", expectedImpact: "i", confidence: "high", metric: "ctr", variants: [{ label: "control" }, { label: "treatment" }] });
    const treatment = e.variants.find((v) => v.label === "treatment")!;
    await recordMetric(h.app, WS, e.id, treatment.id, "ctr", 0.05);
    await transitionExperiment(h.app, WS, e.id, "completed", "treatment wins", treatment.id);
    await expect(transitionExperiment(h.app, WS, e.id, "running", "back")).rejects.toThrow(/illegal/);
    await transitionExperiment(h.app, WS, e.id, "archived", "done");
    const row = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT status, winner_variant_id, decided_at FROM experiments WHERE id = $1`, [e.id]));
    expect(row.rows[0].status).toBe("archived");
    expect(row.rows[0].winner_variant_id).toBe(treatment.id);
    expect(row.rows[0].decided_at).not.toBeNull();
    const audit = await h.admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE event = 'experiment.transition' AND details->>'experimentId' = $1`, [e.id]);
    expect(audit.rows[0].n).toBe(2);
  });

  it("RLS: another workspace sees no experiments", async () => {
    expect((await withWorkspace(h.app, OTHER, (tx) => tx.query(`SELECT * FROM experiments`))).rowCount).toBe(0);
  });
});
