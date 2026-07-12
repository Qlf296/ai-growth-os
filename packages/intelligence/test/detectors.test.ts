/** STEP 3.3/3.4 — SEO detectors are deterministic, evidence-bearing, threshold-driven. */
import { describe, expect, it } from "vitest";

import { aggregatePages, clickDrop, ctrGap, impressionDrop, strikingDistance } from "../src/index.js";
import type { DetectorInput, PageAggregate } from "../src/index.js";

const page = (over: Partial<PageAggregate>): PageAggregate => ({ page: "https://forgcv.com/x", clicks: 0, impressions: 0, ctr: 0, position: 0, ...over });
const input = (recent: PageAggregate[], prior: PageAggregate[] = [], thresholds: Record<string, number> = {}): DetectorInput => ({
  recent, prior, thresholds,
  window: { from: new Date("2026-06-01"), to: new Date("2026-06-14"), splitAt: new Date("2026-06-08") },
});

describe("aggregatePages", () => {
  it("sums clicks/impressions and impression-weights position per page (deterministic order)", () => {
    const rows = [
      { data: { page: "b", clicks: 1, impressions: 100, position: 10 } },
      { data: { page: "a", clicks: 2, impressions: 100, position: 4 } },
      { data: { page: "a", clicks: 3, impressions: 300, position: 8 } },
    ];
    const agg = aggregatePages(rows);
    expect(agg.map((p) => p.page)).toEqual(["a", "b"]);
    expect(agg[0]).toMatchObject({ page: "a", clicks: 5, impressions: 400 });
    expect(agg[0]!.position).toBeCloseTo((4 * 100 + 8 * 300) / 400);
    expect(agg[0]!.ctr).toBeCloseTo(5 / 400);
  });
});

describe("seo.striking_distance", () => {
  it("fires for pages ranking 5–20 with enough impressions; each finding carries evidence", () => {
    const f = strikingDistance.detect(input([page({ page: "p1", position: 12, impressions: 500, clicks: 5 })], [], { position_min: 5, position_max: 20, impressions_floor: 100 }));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ entity: "p1", severity: "info" });
    expect(f[0]!.evidence).toMatchObject({ metric: "position" });
  });
  it("does not fire outside the position band or below the impression floor", () => {
    expect(strikingDistance.detect(input([page({ position: 2, impressions: 500 })], [], { position_min: 5, position_max: 20, impressions_floor: 100 }))).toHaveLength(0);
    expect(strikingDistance.detect(input([page({ position: 12, impressions: 50 })], [], { position_min: 5, position_max: 20, impressions_floor: 100 }))).toHaveLength(0);
  });
});

describe("seo.ctr_gap", () => {
  it("fires when CTR is well below the position expectation", () => {
    const f = ctrGap.detect(input([page({ page: "p2", position: 3, impressions: 1000, clicks: 20, ctr: 0.02 })], [], { impressions_floor: 100, min_gap: 0.3 }));
    expect(f).toHaveLength(1);
    expect(f[0]!.evidence).toMatchObject({ metric: "ctr", expectedCtr: 0.10 });
  });
  it("does not fire when CTR meets expectation", () => {
    expect(ctrGap.detect(input([page({ position: 3, impressions: 1000, ctr: 0.12 })], [], { impressions_floor: 100, min_gap: 0.3 }))).toHaveLength(0);
  });
});

describe("seo.impression_drop / click_drop", () => {
  it("fires on a sharp drop versus prior window", () => {
    const recent = [page({ page: "p3", impressions: 100, clicks: 5 })];
    const prior = [page({ page: "p3", impressions: 400, clicks: 40 })];
    expect(impressionDrop.detect(input(recent, prior, { min_prior_impressions: 200, drop_pct: 0.3 }))).toHaveLength(1);
    expect(clickDrop.detect(input(recent, prior, { min_prior_clicks: 20, drop_pct: 0.3 }))).toHaveLength(1);
  });
  it("ignores pages below the prior floor or without a matching prior page", () => {
    expect(impressionDrop.detect(input([page({ page: "p", impressions: 1 })], [page({ page: "p", impressions: 10 })], { min_prior_impressions: 200, drop_pct: 0.3 }))).toHaveLength(0);
    expect(impressionDrop.detect(input([page({ page: "new", impressions: 1 })], [], { min_prior_impressions: 200, drop_pct: 0.3 }))).toHaveLength(0);
  });
});

describe("determinism", () => {
  it("same input → identical findings and evidence", () => {
    const i = input([page({ page: "p", position: 12, impressions: 500, clicks: 5 })], [], { position_min: 5, position_max: 20, impressions_floor: 100 });
    expect(JSON.stringify(strikingDistance.detect(i))).toBe(JSON.stringify(strikingDistance.detect(i)));
  });
});
