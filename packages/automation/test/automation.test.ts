/** STEP 7.1 — automation model/registry/executor: triggers/conditions/actions as data, ladder-bounded, no publishing. */
import { describe, expect, it } from "vitest";

import {
  ActionRegistry, evalCondition, evaluateRules, ladderAllowed, triggerMatches,
  type ActionHandler, type AutomationRule,
} from "../src/index.js";

const rule = (over: Partial<AutomationRule> = {}): AutomationRule => ({
  id: "r1", workspaceId: "ws", name: "auto-validate high-confidence",
  trigger: { type: "opportunity.detected" },
  condition: [{ field: "confidence", op: "eq", value: "high" }],
  action: "opportunity.validate", ladderLevel: "A2", enabled: true, ...over,
});

const okAction = (name: string): ActionHandler & { calls: number } => {
  const a = { name, publishes: false as const, calls: 0, async run() { a.calls++; return { ok: true, detail: { done: true } }; } };
  return a;
};

describe("condition + trigger evaluation (data-driven, deterministic)", () => {
  it("evaluates AND clauses over a fact with all ops", () => {
    const fact = { confidence: "high", priorityScore: 0.8, detector: "seo.ctr_gap" };
    expect(evalCondition(fact, [{ field: "confidence", op: "eq", value: "high" }, { field: "priorityScore", op: "gte", value: 0.7 }])).toBe(true);
    expect(evalCondition(fact, [{ field: "priorityScore", op: "lt", value: 0.5 }])).toBe(false);
    expect(evalCondition(fact, [{ field: "detector", op: "in", value: ["seo.ctr_gap", "seo.striking_distance"] }])).toBe(true);
  });
  it("trigger matches on type and optional filter", () => {
    const r = rule({ trigger: { type: "opportunity.detected", filter: [{ field: "category", op: "eq", value: "seo" }] } });
    expect(triggerMatches(r, "opportunity.detected", { category: "seo" })).toBe(true);
    expect(triggerMatches(r, "opportunity.detected", { category: "social" })).toBe(false);
    expect(triggerMatches(r, "experiment.completed", { category: "seo" })).toBe(false);
  });
});

describe("automation ladder (ADR-048) and no-publish (Law 5)", () => {
  it("A0–A2 allowed; the registry refuses any publishing action", () => {
    expect(ladderAllowed("A2")).toBe(true);
    const reg = new ActionRegistry();
    expect(() => reg.register({ name: "publish.post", publishes: true, run: async () => ({ ok: true, detail: {} }) } as never)).toThrow(/forbidden/i);
  });
});

describe("evaluateRules", () => {
  it("runs a matching, permitted, condition-passing rule via the action registry", async () => {
    const reg = new ActionRegistry();
    const action = okAction("opportunity.validate");
    reg.register(action);
    const res = await evaluateRules(reg, [rule()], "opportunity.detected", { confidence: "high" }, "ws");
    expect(res).toEqual([{ ruleId: "r1", status: "ok", detail: { done: true } }]);
    expect(action.calls).toBe(1);
  });

  it("skips disabled rules, non-matching triggers and false conditions", async () => {
    const reg = new ActionRegistry(); reg.register(okAction("opportunity.validate"));
    expect(await evaluateRules(reg, [rule({ enabled: false })], "opportunity.detected", { confidence: "high" }, "ws")).toEqual([]);
    expect(await evaluateRules(reg, [rule()], "experiment.completed", { confidence: "high" }, "ws")).toEqual([]);
    const skip = await evaluateRules(reg, [rule()], "opportunity.detected", { confidence: "low" }, "ws");
    expect(skip[0]!.status).toBe("skipped");
  });

  it("is idempotent via alreadyExecuted", async () => {
    const reg = new ActionRegistry(); const action = okAction("opportunity.validate"); reg.register(action);
    const res = await evaluateRules(reg, [rule()], "opportunity.detected", { confidence: "high" }, "ws", { alreadyExecuted: async () => true });
    expect(res[0]!.status).toBe("skipped");
    expect(action.calls).toBe(0);
  });

  it("an action error is captured, not thrown", async () => {
    const reg = new ActionRegistry();
    reg.register({ name: "opportunity.validate", publishes: false, run: async () => { throw new Error("boom"); } });
    const res = await evaluateRules(reg, [rule()], "opportunity.detected", { confidence: "high" }, "ws");
    expect(res[0]!.status).toBe("error");
    expect(res[0]!.detail.error).toMatch(/boom/);
  });
});
