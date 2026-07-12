/**
 * Signal registry (STEP 3.1) — taxonomy and metadata as DATA. Detectors and
 * findings reference this catalog; adding a signal/detector kind is a data
 * change, not a code fork. Workspace isolation is enforced at the row level
 * by RLS on the tables that carry these values (findings/evidence/runs).
 */
export type Category = "seo";
export type Severity = "info" | "low" | "medium" | "high";
export type Confidence = "low" | "medium" | "high";

/** The normalized signal types the intelligence layer consumes (produced by adapters). */
export interface SignalTypeMeta {
  readonly type: string;
  readonly source: string; // provider
  readonly description: string;
}

export const SIGNAL_TYPES: readonly SignalTypeMeta[] = [
  { type: "gsc.search_analytics.daily", source: "gsc", description: "Daily query×page clicks/impressions/ctr/position" },
];

/** Detector catalog metadata (severity/priority/category defaults live in rules-as-data). */
export interface DetectorMeta {
  readonly name: string;
  readonly category: Category;
  readonly defaultSeverity: Severity;
  readonly consumes: string; // signal type
  readonly description: string;
}

export const DETECTOR_CATALOG: readonly DetectorMeta[] = [
  { name: "seo.striking_distance", category: "seo", defaultSeverity: "info", consumes: "gsc.search_analytics.daily", description: "Pages ranking just outside top positions with real impression volume." },
  { name: "seo.ctr_gap", category: "seo", defaultSeverity: "low", consumes: "gsc.search_analytics.daily", description: "Pages whose CTR is well below the expectation for their position." },
  { name: "seo.impression_drop", category: "seo", defaultSeverity: "medium", consumes: "gsc.search_analytics.daily", description: "Pages whose impressions dropped sharply versus the prior window." },
  { name: "seo.click_drop", category: "seo", defaultSeverity: "medium", consumes: "gsc.search_analytics.daily", description: "Pages whose clicks dropped sharply versus the prior window." },
];
