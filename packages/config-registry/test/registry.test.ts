/**
 * Tests written BEFORE the implementation (BUILD_RULES: architecture tests
 * are written before the code they guard).
 *
 * Guarded rules:
 *  - ADR-046: config-as-data, stability tags (experiment | stable | frozen)
 *  - ADR-045 / AT-14: decision-affecting changes require a linked shadow-eval
 *  - DECISION_LIFECYCLE: experiment→stable graduation requires shadow-eval evidence
 *  - I1 / ADR-044: deterministic, immutable config snapshots
 *  - History is append-only
 */
import { describe, expect, it } from "vitest";

import {
  ConfigRegistry,
  InMemoryConfigStore,
  bool,
  num,
  oneOf,
} from "../src/index.js";

function makeRegistry() {
  const registry = new ConfigRegistry(new InMemoryConfigStore());
  registry.define({
    key: "recommendation.w_goal",
    description: "Scoring weight: goal alignment (S16 §7)",
    owner: "recommendation",
    stability: "experiment",
    decisionAffecting: true,
    schema: num({ min: 0, max: 1 }),
    defaultValue: 0.3,
  });
  registry.define({
    key: "recommendation.exploration_rate",
    description: "Seeded exploration slot rate (S16, honest label mandatory)",
    owner: "recommendation",
    stability: "experiment",
    decisionAffecting: true,
    schema: num({ min: 0, max: 0.5 }),
    defaultValue: 0.1,
  });
  registry.define({
    key: "delivery.digest_enabled",
    description: "Daily digest master switch (S13)",
    owner: "delivery",
    stability: "stable",
    decisionAffecting: false,
    schema: bool(),
    defaultValue: true,
  });
  registry.define({
    key: "governance.ordering_invariant_margin",
    description: "I2 margin — learning tilts, never flips",
    owner: "governance",
    stability: "frozen",
    decisionAffecting: true,
    schema: num({ min: 0 }),
    defaultValue: 0.15,
  });
  registry.define({
    key: "gateway.default_model_tier",
    description: "Default ladder tier for non-frontier calls (ADR-009)",
    owner: "ai-gateway",
    stability: "stable",
    decisionAffecting: false,
    schema: oneOf(["t0", "t1", "t2", "t3"] as const),
    defaultValue: "t1",
  });
  return registry;
}

describe("definition", () => {
  it("rejects duplicate keys", () => {
    const r = makeRegistry();
    expect(() =>
      r.define({
        key: "recommendation.w_goal",
        description: "dup",
        owner: "recommendation",
        stability: "experiment",
        decisionAffecting: true,
        schema: num({}),
        defaultValue: 0.1,
      }),
    ).toThrow(/already defined/i);
  });

  it("rejects a default value that fails its own schema", () => {
    const r = new ConfigRegistry(new InMemoryConfigStore());
    expect(() =>
      r.define({
        key: "x.bad_default",
        description: "invalid default",
        owner: "test",
        stability: "experiment",
        decisionAffecting: false,
        schema: num({ min: 0, max: 1 }),
        defaultValue: 2,
      }),
    ).toThrow(/schema/i);
  });

  it("reads of unknown keys fail loudly (no silent hardcoded fallback)", async () => {
    const r = makeRegistry();
    await expect(r.get("nope.unknown")).rejects.toThrow(/not defined/i);
  });
});

describe("precedence (default < global override < workspace override)", () => {
  it("returns the default when nothing is overridden", async () => {
    const r = makeRegistry();
    expect(await r.get("recommendation.w_goal")).toBe(0.3);
  });

  it("global override beats default; workspace override beats global", async () => {
    const r = makeRegistry();
    await r.setOverride("recommendation.w_goal", 0.35, {
      changedBy: "founder",
      reason: "test",
      shadowEvalRef: "shadow-eval-001",
    });
    expect(await r.get("recommendation.w_goal")).toBe(0.35);
    await r.setOverride("recommendation.w_goal", 0.4, {
      changedBy: "founder",
      reason: "test ws",
      shadowEvalRef: "shadow-eval-002",
      workspaceId: "ws_1",
    });
    expect(await r.get("recommendation.w_goal", { workspaceId: "ws_1" })).toBe(0.4);
    expect(await r.get("recommendation.w_goal", { workspaceId: "ws_2" })).toBe(0.35);
  });

  it("rejects override values that fail the schema", async () => {
    const r = makeRegistry();
    await expect(
      r.setOverride("recommendation.w_goal", 7, {
        changedBy: "founder",
        reason: "bad",
        shadowEvalRef: "shadow-eval-003",
      }),
    ).rejects.toThrow(/schema/i);
  });
});

describe("ADR-045 / AT-14 — decision-affecting gate", () => {
  it("refuses to activate a decision-affecting change without a shadow-eval ref", async () => {
    const r = makeRegistry();
    await expect(
      r.setOverride("recommendation.exploration_rate", 0.2, {
        changedBy: "founder",
        reason: "no eval",
      }),
    ).rejects.toThrow(/shadow[- ]?eval/i);
  });

  it("accepts it with a linked shadow-eval ref", async () => {
    const r = makeRegistry();
    await r.setOverride("recommendation.exploration_rate", 0.2, {
      changedBy: "founder",
      reason: "ratified",
      shadowEvalRef: "shadow-eval-042",
    });
    expect(await r.get("recommendation.exploration_rate")).toBe(0.2);
  });

  it("non-decision-affecting keys change without shadow-eval", async () => {
    const r = makeRegistry();
    await r.setOverride("delivery.digest_enabled", false, {
      changedBy: "founder",
      reason: "ui toggle",
    });
    expect(await r.get("delivery.digest_enabled")).toBe(false);
  });
});

describe("stability (ADR-046 + DECISION_LIFECYCLE)", () => {
  it("frozen keys cannot be overridden at runtime — full lifecycle required", async () => {
    const r = makeRegistry();
    await expect(
      r.setOverride("governance.ordering_invariant_margin", 0.2, {
        changedBy: "founder",
        reason: "attempt",
        shadowEvalRef: "shadow-eval-x",
      }),
    ).rejects.toThrow(/frozen/i);
  });

  it("experiment→stable graduation requires shadow-eval evidence", () => {
    const r = makeRegistry();
    expect(() =>
      r.graduate("recommendation.w_goal", "stable", { changedBy: "founder" }),
    ).toThrow(/shadow[- ]?eval/i);
    r.graduate("recommendation.w_goal", "stable", {
      changedBy: "founder",
      shadowEvalRef: "shadow-eval-100",
    });
    expect(r.describe("recommendation.w_goal").stability).toBe("stable");
  });

  it("stability can only move forward (experiment → stable → frozen), never back", () => {
    const r = makeRegistry();
    expect(() =>
      r.graduate("delivery.digest_enabled", "experiment", { changedBy: "founder" }),
    ).toThrow(/forward/i);
  });
});

describe("snapshots (I1 determinism, ADR-044 traces)", () => {
  it("snapshot is deterministic: same state → same hash", async () => {
    const a = await makeRegistry().snapshot();
    const b = await makeRegistry().snapshot();
    expect(a.hash).toBe(b.hash);
  });

  it("snapshot hash changes when an override lands", async () => {
    const r = makeRegistry();
    const before = await r.snapshot();
    await r.setOverride("recommendation.w_goal", 0.35, {
      changedBy: "founder",
      reason: "test",
      shadowEvalRef: "shadow-eval-001",
    });
    const after = await r.snapshot();
    expect(after.hash).not.toBe(before.hash);
  });

  it("an existing snapshot is immutable — later overrides do not mutate it", async () => {
    const r = makeRegistry();
    const snap = await r.snapshot();
    await r.setOverride("recommendation.w_goal", 0.9, {
      changedBy: "founder",
      reason: "later",
      shadowEvalRef: "shadow-eval-z",
    });
    expect(snap.values["recommendation.w_goal"]).toBe(0.3);
    expect(Object.isFrozen(snap.values)).toBe(true);
  });

  it("reading from a snapshot is workspace-aware", async () => {
    const r = makeRegistry();
    await r.setOverride("recommendation.w_goal", 0.4, {
      changedBy: "founder",
      reason: "ws",
      shadowEvalRef: "shadow-eval-1",
      workspaceId: "ws_1",
    });
    const snap = await r.snapshot({ workspaceId: "ws_1" });
    expect(snap.values["recommendation.w_goal"]).toBe(0.4);
  });
});

describe("append-only history", () => {
  it("every change is recorded and the log cannot shrink", async () => {
    const r = makeRegistry();
    await r.setOverride("delivery.digest_enabled", false, {
      changedBy: "founder",
      reason: "one",
    });
    await r.setOverride("delivery.digest_enabled", true, {
      changedBy: "founder",
      reason: "two",
    });
    const history = await r.history("delivery.digest_enabled");
    expect(history).toHaveLength(2);
    expect(history[0]?.reason).toBe("one");
    expect(history[1]?.reason).toBe("two");
    expect(Object.isFrozen(history)).toBe(true);
  });
});
