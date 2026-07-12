/** Detector contract (STEP 3.2/3.3; S10 §0). Deterministic, evidence-bearing, no AI. */
import type { Category, Confidence, Severity } from "../registry.js";
import type { EvidenceInput } from "../evidence.js";

export interface PageAggregate {
  readonly page: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;      // clicks / impressions
  readonly position: number; // impression-weighted average
}

export interface DetectorWindow {
  readonly from: Date;
  readonly to: Date;
  readonly splitAt: Date; // prior [from, splitAt) vs recent [splitAt, to]
}

export interface DetectorInput {
  readonly recent: readonly PageAggregate[];
  readonly prior: readonly PageAggregate[];
  readonly window: DetectorWindow;
  readonly thresholds: Record<string, number>;
}

export interface Finding {
  readonly entity: string;      // affected page
  readonly severity: Severity;
  readonly confidence: Confidence;
  readonly explanation: string;
  readonly data: Record<string, unknown>;
  readonly evidence: EvidenceInput["data"]; // becomes an evidence row (I4)
}

export interface Detector {
  readonly name: string;
  readonly category: Category;
  detect(input: DetectorInput): Finding[];
}
