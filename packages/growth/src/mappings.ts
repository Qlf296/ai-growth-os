/**
 * Deterministic classification tables (data). Impact/difficulty/effort/ROI are
 * derived from detector + severity — never invented values (Law 15/ADR-034:
 * measured units, unmonetized until real revenue attribution).
 */
export type Tier = "low" | "medium" | "high";
export type Severity = "info" | "low" | "medium" | "high";
export type Confidence = "low" | "medium" | "high";

export const SEVERITY_RANK: Record<Severity, number> = { info: 1, low: 2, medium: 3, high: 4 };
export const CONFIDENCE_RANK: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };
export const IMPACT_RANK: Record<Tier, number> = { low: 1, medium: 2, high: 3 };
export const EFFORT_RANK: Record<Tier, number> = { low: 3, medium: 2, high: 1 }; // less effort scores higher

export interface DetectorProfile {
  readonly impact: Tier;
  readonly difficulty: Tier;
  readonly effort: Tier;
}

/** Per-detector fixed profile (deterministic). */
export const DETECTOR_PROFILE: Record<string, DetectorProfile> = {
  "seo.striking_distance": { impact: "medium", difficulty: "low", effort: "low" },
  "seo.ctr_gap": { impact: "medium", difficulty: "low", effort: "low" },
  "seo.impression_drop": { impact: "high", difficulty: "medium", effort: "medium" },
  "seo.click_drop": { impact: "high", difficulty: "medium", effort: "medium" },
};

export const EFFORT_LABEL: Record<Tier, string> = { low: "~15m", medium: "~30m", high: "~2h" };

/** Honest ROI: measured units only, never monetized without verified attribution (ADR-034). */
export function makeRoi(impact: Tier): { monetized: false; unit: "clicks"; basis: "measured"; potential: Tier } {
  return { monetized: false, unit: "clicks", basis: "measured", potential: impact };
}
