/**
 * SLOs as data (ADR-047: every SLI has an owner; PERFORMANCE_BUDGET: a
 * consumed margin is a warning — degraded even while the SLO passes).
 */
import type { MetricsSnapshot } from "./metrics.js";

export interface SloDefinition {
  readonly name: string;
  readonly owner: string;               // ADR-047 — accountable module
  readonly histogram: string;           // SLI source
  readonly p95TargetMs: number;         // the SLO ceiling
  readonly segmentBudgetMs: number;     // sum of owned segment budgets
}

export type SloState = "ok" | "degraded" | "breach" | "unknown";

export interface SloResult {
  readonly name: string;
  readonly state: SloState;
  readonly p95: number;
}

export function evaluateSlo(slo: SloDefinition, snapshot: MetricsSnapshot): SloResult {
  const h = snapshot.histograms[slo.histogram];
  if (!h || h.count === 0) return { name: slo.name, state: "unknown", p95: 0 };
  const state: SloState =
    h.p95 > slo.p95TargetMs ? "breach" : h.p95 > slo.segmentBudgetMs ? "degraded" : "ok";
  return { name: slo.name, state, p95: h.p95 };
}

/** Launch SLOs (PERFORMANCE_BUDGET) — data, owners named. */
export const LAUNCH_SLOS: readonly SloDefinition[] = [
  { name: "today_feed_load", owner: "recommendation", histogram: "feed.load_ms", p95TargetMs: 800, segmentBudgetMs: 500 },
  { name: "on_accept_draft", owner: "ai-gateway", histogram: "draft.total_ms", p95TargetMs: 15_000, segmentBudgetMs: 15_000 },
  { name: "feed_assembly_job", owner: "recommendation", histogram: "feed.assemble_ms", p95TargetMs: 30_000, segmentBudgetMs: 20_000 },
];
