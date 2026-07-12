/**
 * Phase 8.5 — analytics learning loop end-to-end:
 * detection → growth → completed opportunity → outcome measured + graded →
 * learning propagated (detector track record) → analytics summary reflects it.
 * Real Postgres, fixtures only, evidence-backed throughout (I4).
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { analyticsSummary, propagateLearning, recordOutcome } from "@aigos/analytics";
import { ConfigRegistry, InMemoryConfigStore } from "@aigos/config-registry";
import { ConnectionRepository, SignalRepository, withWorkspace } from "@aigos/database";
import { buildGrowth, registerGrowthWeights, transitionOpportunity } from "@aigos/growth";
import { runDetection } from "@aigos/intelligence";

import { startHarness, seedWorkspace, type Harness } from "../../../packages/database/test/harness.js";

let h: Harness;
const WS = randomUUID();
const USER = randomUUID();
let connectionId = "";
const DAY = "2026-06-15";

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  await h.admin.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@t.dev', 'magic_link')`, [USER]);
  connectionId = await withWorkspace(h.app, WS, (tx) => new ConnectionRepository().create(tx, { provider: "gsc", scopes: [], capabilities: {}, authorizedBy: USER }));
  for (const d of ["2026-06-09", "2026-06-11", "2026-06-13"]) {
    const externalId = `${d}|q|https://forgcv.com/cv`;
    await withWorkspace(h.app, WS, (tx) => new SignalRepository().insertMany(tx, [{
      connectionId, source: "gsc", type: "gsc.search_analytics.daily", externalId,
      occurredAt: new Date(`${d}T00:00:00Z`), payloadRef: `${WS}/gsc/${d}/x`,
      data: { page: "https://forgcv.com/cv", query: "q", clicks: 5, impressions: 400, ctr: 0.0125, position: 14 },
      normalizerVersion: 1, dedupeHash: createHash("sha256").update(`gsc|daily|${externalId}`).digest("hex"),
    }]));
  }
}, 120_000);

afterAll(async () => { await h.stop(); });

describe("analytics learning loop", () => {
  it("measures a completed opportunity, grades it, propagates learning, and the summary reflects it", async () => {
    await runDetection({ pool: h.app, workspaceId: WS, now: new Date(`${DAY}T00:00:00Z`), windowDays: 7 });
    const config = new ConfigRegistry(new InMemoryConfigStore()); registerGrowthWeights(config);
    await buildGrowth({ pool: h.app, config, workspaceId: WS, day: DAY });
    const opp = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT id, detectors FROM opportunities LIMIT 1`));
    const opportunityId = opp.rows[0].id as string;
    const detector = (opp.rows[0].detectors as string[])[0]!;

    // Human completes it, then the outcome is measured (met) and graded.
    await transitionOpportunity(h.app, WS, opportunityId, "validated", "human");
    await transitionOpportunity(h.app, WS, opportunityId, "accepted", "human");
    await transitionOpportunity(h.app, WS, opportunityId, "completed", "human");
    const outcome = await recordOutcome(h.app, WS, { subjectType: "opportunity", subjectId: opportunityId, metric: "ctr", baselineValue: 0.0125, observedValue: 0.02, windowDays: 28, targetImprovement: 0.1 });
    expect(outcome.verdict).toBe("met");
    expect(["A", "B", "B+", "C"]).toContain(outcome.grade);

    // Propagate learning; the detector now has a track record.
    const learned = await propagateLearning(h.app, WS, { minSamples: 1 });
    const d = learned.find((l) => l.detector === detector)!;
    expect(d.score).toBeGreaterThan(0);
    expect(d.health).toBe("healthy");

    // Analytics summary reflects the measured, graded, evidence-backed outcome.
    const summary = await analyticsSummary(h.app, WS);
    expect(summary.totalMeasured).toBe(1);
    expect(summary.met).toBe(1);
    expect(summary.outcomes[0]!.evidenceReferenceId).toBe(outcome.evidenceReferenceId); // I4 end-to-end
    expect(summary.trackRecord.find((t) => t.detector === detector)!.health).toBe("healthy");
  });
});
