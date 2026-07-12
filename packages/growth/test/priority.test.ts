/** STEP 4.2 — deterministic scoring, weighting, stable ranking, tie-breaking. */
import { describe, expect, it } from "vitest";

import { DEFAULT_WEIGHTS, buildOpportunities, buildRecommendation, rankOpportunities, score } from "../src/index.js";
import type { StoredFinding } from "@aigos/intelligence";

const finding = (over: Partial<StoredFinding>): StoredFinding => ({
  id: "f", detector: "seo.striking_distance", detectorVersion: 1, category: "seo",
  severity: "info", confidence: "medium", entity: "https://forgcv.com/a", data: {}, evidenceId: "e1", occurredAt: new Date(),
  ...over,
});

describe("score", () => {
  it("is deterministic and base (severity) dominates over effort", () => {
    const a = score({ severity: "high", confidence: "low", impact: "low", effort: "low" }, DEFAULT_WEIGHTS);
    const b = score({ severity: "info", confidence: "high", impact: "high", effort: "high" }, DEFAULT_WEIGHTS);
    expect(a.score).toBe(score({ severity: "high", confidence: "low", impact: "low", effort: "low" }, DEFAULT_WEIGHTS).score);
    expect(a.score).toBeGreaterThan(b.score); // severity weight dominates
    expect(a.trace.terms.severity).toBeGreaterThan(a.trace.terms.effort);
  });
});

describe("rankOpportunities tie-breaking", () => {
  it("orders by score desc, then entity asc, then id asc — stable and reproducible", () => {
    const items = [
      { id: "z", entity: "b", priorityScore: 0.5 },
      { id: "a", entity: "a", priorityScore: 0.5 },
      { id: "m", entity: "a", priorityScore: 0.9 },
    ];
    const ranked = rankOpportunities(items).map((i) => i.id);
    expect(ranked).toEqual(["m", "a", "z"]);
    expect(rankOpportunities(items).map((i) => i.id)).toEqual(ranked); // reproducible
  });
});

describe("buildOpportunities (ADR-031 grouping)", () => {
  it("groups findings on one page into a single opportunity carrying union of detectors + evidence", () => {
    const drafts = buildOpportunities([
      finding({ detector: "seo.striking_distance", severity: "info", evidenceId: "e1" }),
      finding({ detector: "seo.impression_drop", severity: "medium", confidence: "high", evidenceId: "e2" }),
    ], "2026-06-15");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.detectors).toEqual(["seo.impression_drop", "seo.striking_distance"]);
    expect(drafts[0]!.dominantDetector).toBe("seo.impression_drop"); // highest severity
    expect(drafts[0]!.severity).toBe("medium");
    expect(drafts[0]!.evidenceIds).toEqual(["e1", "e2"]);
    expect(drafts[0]!.roi.monetized).toBe(false); // Law 15 — never invented value
  });
});

describe("buildRecommendation (data only, no generated text)", () => {
  it("produces a structured recommendation with all required fields from a template", () => {
    const [draft] = buildOpportunities([finding({ detector: "seo.ctr_gap", severity: "low", evidenceId: "e1" })], "2026-06-15");
    const rec = buildRecommendation(draft!);
    for (const key of ["title", "summary", "businessReason", "technicalReason", "expectedImpact", "rollback"] as const) {
      expect(typeof rec[key]).toBe("string");
      expect(rec[key].length).toBeGreaterThan(0);
    }
    expect(rec.affectedEntities).toEqual([draft!.entity]);
    expect(rec.evidenceIds).toEqual(draft!.evidenceIds);
    expect(rec.steps.length).toBeGreaterThan(0);
    expect(rec.prerequisites.length).toBeGreaterThan(0);
  });
});
