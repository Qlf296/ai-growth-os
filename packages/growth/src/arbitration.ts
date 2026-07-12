/**
 * Recommendation Arbitration V2 (STEP 9.3; ADR-013 bounded learning; I2 base
 * dominates). The base priority score is multiplied by a BOUNDED track-record
 * factor derived from the detector's learned score (ADR-042). Learning tilts,
 * never flips: the factor stays within [1-bound, 1+bound], and activation is
 * gated by a mandatory shadow evaluation (ADR-045) that rejects any ranking
 * flip larger than the ordering-invariant margin (rollback to V1).
 */
import { num, type ConfigRegistry } from "@aigos/config-registry";

/** Decision-affecting: overrides require a linked shadow-eval (AT-14/ADR-045). */
export function registerArbitrationConfig(config: ConfigRegistry): void {
  config.define({
    key: "growth.arbitration.track_record_bound",
    description: "Max +/- fraction the learned track record may tilt a base priority score (ADR-013; ≤ ordering margin)",
    owner: "recommendation", stability: "experiment", decisionAffecting: true,
    schema: num({ min: 0, max: 0.3 }), defaultValue: 0.15,
  });
}

export interface ArbitrationResult {
  score: number;
  factor: number;
  trace: { baseScore: number; trackRecordScore: number | null; bound: number; factor: number };
}

/**
 * Bounded multiplier. A null track record (insufficient data) abstains (factor 1,
 * ADR-013). Otherwise map [0,1] → [1-bound, 1+bound] linearly and clamp.
 */
export function arbitrateV2(baseScore: number, trackRecordScore: number | null, bound: number): ArbitrationResult {
  const factor = trackRecordScore === null
    ? 1
    : Math.max(1 - bound, Math.min(1 + bound, 1 + bound * (trackRecordScore * 2 - 1)));
  const score = Math.round(baseScore * factor * 1e6) / 1e6;
  return { score, factor, trace: { baseScore, trackRecordScore, bound, factor } };
}

export interface ShadowItem { id: string; base: number; v2: number; }
export interface ShadowReport { passed: boolean; forbiddenFlips: number; comparisons: number; }

/**
 * Shadow evaluation (ADR-045): compare the V1 (base) and V2 ranking. A
 * "forbidden flip" is a pair whose order reverses even though their base scores
 * differ by more than `margin` — that would mean learning overturned the base
 * (I2 violation). passed = zero forbidden flips ⇒ V2 may activate; else rollback.
 */
export function shadowEvaluateArbitration(items: readonly ShadowItem[], margin: number): ShadowReport {
  let forbiddenFlips = 0;
  let comparisons = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!, b = items[j]!;
      comparisons += 1;
      const baseDiff = a.base - b.base;
      if (Math.abs(baseDiff) <= margin) continue; // within margin: a flip is allowed (learning tilts)
      const baseOrder = Math.sign(baseDiff);
      const v2Order = Math.sign(a.v2 - b.v2);
      if (v2Order !== 0 && v2Order !== baseOrder) forbiddenFlips += 1;
    }
  }
  return { passed: forbiddenFlips === 0, forbiddenFlips, comparisons };
}
