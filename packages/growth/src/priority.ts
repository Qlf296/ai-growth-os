/**
 * Priority Engine (STEP 4.2). Deterministic weighted score with a full trace,
 * stable ranking and explicit tie-breaking. Weights are config (ADR-046);
 * base (severity) dominates so learning tilts, never flips (I2 spirit).
 */
import type { ConfigRegistry } from "@aigos/config-registry";
import { num } from "@aigos/config-registry";

import { CONFIDENCE_RANK, EFFORT_RANK, IMPACT_RANK, SEVERITY_RANK, type Confidence, type Severity, type Tier } from "./mappings.js";

export interface Weights {
  severity: number;
  confidence: number;
  impact: number;
  effort: number;
}

export const DEFAULT_WEIGHTS: Weights = { severity: 0.4, confidence: 0.2, impact: 0.3, effort: 0.1 };

/** Register weight keys (decision-affecting → overrides require shadow-eval, AT-14). */
export function registerGrowthWeights(config: ConfigRegistry): void {
  const def = (key: string, value: number): void =>
    config.define({ key, description: `Priority weight ${key}`, owner: "recommendation", stability: "experiment", decisionAffecting: true, schema: num({ min: 0, max: 1 }), defaultValue: value });
  def("growth.weight.severity", DEFAULT_WEIGHTS.severity);
  def("growth.weight.confidence", DEFAULT_WEIGHTS.confidence);
  def("growth.weight.impact", DEFAULT_WEIGHTS.impact);
  def("growth.weight.effort", DEFAULT_WEIGHTS.effort);
}

export async function loadWeights(config: ConfigRegistry, workspaceId: string): Promise<Weights> {
  const g = (k: string): Promise<number> => config.get<number>(k, { workspaceId });
  return {
    severity: await g("growth.weight.severity"),
    confidence: await g("growth.weight.confidence"),
    impact: await g("growth.weight.impact"),
    effort: await g("growth.weight.effort"),
  };
}

export interface ScoreInput {
  severity: Severity;
  confidence: Confidence;
  impact: Tier;
  effort: Tier;
}

export interface ScoreResult {
  score: number;
  trace: {
    weights: Weights;
    factors: { severity: number; confidence: number; impact: number; effort: number };
    terms: { severity: number; confidence: number; impact: number; effort: number };
  };
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

export function score(input: ScoreInput, weights: Weights): ScoreResult {
  const factors = {
    severity: SEVERITY_RANK[input.severity] / 4,
    confidence: CONFIDENCE_RANK[input.confidence] / 3,
    impact: IMPACT_RANK[input.impact] / 3,
    effort: EFFORT_RANK[input.effort] / 3,
  };
  const terms = {
    severity: weights.severity * factors.severity,
    confidence: weights.confidence * factors.confidence,
    impact: weights.impact * factors.impact,
    effort: weights.effort * factors.effort,
  };
  return { score: round(terms.severity + terms.confidence + terms.impact + terms.effort), trace: { weights, factors, terms } };
}

/** Stable ranking: score desc, then entity asc, then id asc (deterministic, reproducible). */
export function rankOpportunities<T extends { priorityScore: number; entity: string; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    b.priorityScore - a.priorityScore || (a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
