/** STEP 9.3 — Arbitration V2: bounded, deterministic, abstains, shadow-eval gate (I2/ADR-013/045). */
import { describe, expect, it } from "vitest";

import { ConfigRegistry, InMemoryConfigStore } from "@aigos/config-registry";

import { arbitrateV2, registerArbitrationConfig, shadowEvaluateArbitration } from "../src/index.js";

describe("arbitrateV2 (bounded, deterministic)", () => {
  it("keeps the factor within [1-bound, 1+bound] and is deterministic", () => {
    for (const tr of [0, 0.25, 0.5, 0.75, 1]) {
      const r = arbitrateV2(0.5, tr, 0.15);
      expect(r.factor).toBeGreaterThanOrEqual(1 - 0.15 - 1e-9);
      expect(r.factor).toBeLessThanOrEqual(1 + 0.15 + 1e-9);
    }
    expect(arbitrateV2(0.5, 0.8, 0.15).score).toBe(arbitrateV2(0.5, 0.8, 0.15).score);
    expect(arbitrateV2(0.5, 0.5, 0.15).factor).toBeCloseTo(1); // neutral track record → no tilt
  });

  it("abstains when the track record is null (insufficient data → factor 1)", () => {
    expect(arbitrateV2(0.7, null, 0.15).factor).toBe(1);
    expect(arbitrateV2(0.7, null, 0.15).score).toBeCloseTo(0.7);
  });

  it("config bound is decision-affecting (override needs shadow-eval)", async () => {
    const config = new ConfigRegistry(new InMemoryConfigStore());
    registerArbitrationConfig(config);
    expect(await config.get("growth.arbitration.track_record_bound")).toBe(0.15);
    await expect(config.setOverride("growth.arbitration.track_record_bound", 0.2, { changedBy: "x", reason: "no eval" })).rejects.toThrow(/shadow[- ]?eval/i);
  });
});

describe("shadowEvaluateArbitration (ADR-045, I2 base dominance)", () => {
  it("passes when learning only reorders pairs within the margin", () => {
    // base scores close (diff 0.05 < margin 0.15): a flip is allowed
    const items = [{ id: "a", base: 0.50, v2: 0.48 }, { id: "b", base: 0.55, v2: 0.56 }];
    expect(shadowEvaluateArbitration(items, 0.15).passed).toBe(true);
  });

  it("fails (rollback) when a large base gap is overturned by learning", () => {
    // base gap 0.4 >> margin; v2 reverses the order → forbidden flip
    const items = [{ id: "a", base: 0.9, v2: 0.4 }, { id: "b", base: 0.5, v2: 0.6 }];
    const report = shadowEvaluateArbitration(items, 0.15);
    expect(report.passed).toBe(false);
    expect(report.forbiddenFlips).toBe(1);
  });

  it("with the bounded multiplier, base dominance holds across a realistic set", () => {
    const bound = 0.15;
    const set = [
      { id: "hi", base: 0.9, tr: 0.0 },   // worst track record
      { id: "mid", base: 0.6, tr: 1.0 },  // best track record
      { id: "lo", base: 0.3, tr: 1.0 },
    ];
    const items = set.map((s) => ({ id: s.id, base: s.base, v2: arbitrateV2(s.base, s.tr, bound).score }));
    // 0.9*(0.85)=0.765 still > 0.6*(1.15)=0.69 → base gap 0.3 not overturned
    expect(shadowEvaluateArbitration(items, bound).passed).toBe(true);
  });
});
