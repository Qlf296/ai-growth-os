/**
 * STEP 10.4 — production provider registry (still the sole model path, AT-6/I6).
 * Deterministic selection, fallback across providers, per-provider circuit
 * breaker + timeout + retry (reusing @aigos/infra resilience), cost accounting
 * and an audit trail of every attempt.
 */
import { describe, expect, it } from "vitest";

import {
  AllProvidersFailedError,
  CostAccountant,
  ProviderRegistry,
  type ProviderAudit,
  type ModelProvider,
} from "../src/index.js";

const provider = (name: string, behavior: (prompt: string) => Promise<{ text: string; inputTokens: number; outputTokens: number; costEur: number }>): ModelProvider => ({
  name,
  invoke: (prompt) => behavior(prompt),
});

const ok = (name: string, costEur = 0.01): ModelProvider =>
  provider(name, async (p) => ({ text: `${name}:${p}`, inputTokens: 10, outputTokens: 5, costEur }));
const fail = (name: string): ModelProvider =>
  provider(name, async () => {
    throw new Error(`${name} down`);
  });

describe("ProviderRegistry selection", () => {
  it("orders candidates deterministically by priority then name, filtered by tier", () => {
    const reg = new ProviderRegistry();
    reg.register({ provider: ok("openai"), tiers: ["t3", "t4"], priority: 10 });
    reg.register({ provider: ok("anthropic"), tiers: ["t3", "t4"], priority: 0 });
    reg.register({ provider: ok("groq"), tiers: ["t3"], priority: 0 });
    expect(reg.candidates("t4").map((p) => p.name)).toEqual(["anthropic", "openai"]);
    expect(reg.candidates("t3").map((p) => p.name)).toEqual(["anthropic", "groq", "openai"]);
  });

  it("rejects duplicate provider names and empty candidate sets", () => {
    const reg = new ProviderRegistry();
    reg.register({ provider: ok("x"), tiers: ["t3"], priority: 0 });
    expect(() => reg.register({ provider: ok("x"), tiers: ["t4"], priority: 1 })).toThrow(/already/);
    expect(() => reg.compose({}).invoke("hi", "t4")).rejects.toThrow(AllProvidersFailedError);
  });
});

describe("ProviderRegistry fallback + audit + accounting", () => {
  const setup = () => {
    const audits: ProviderAudit[] = [];
    const accountant = new CostAccountant();
    const reg = new ProviderRegistry();
    return { audits, accountant, reg };
  };

  it("serves from the primary and records ok + cost", async () => {
    const { audits, accountant, reg } = setup();
    reg.register({ provider: ok("primary", 0.02), tiers: ["t4"], priority: 0 });
    reg.register({ provider: ok("secondary"), tiers: ["t4"], priority: 1 });
    const composite = reg.compose({ onAudit: (a) => audits.push(a), accountant });
    const res = await composite.invoke("hello", "t4");
    expect(res.text).toBe("primary:hello");
    expect(audits.map((a) => `${a.provider}:${a.outcome}`)).toEqual(["primary:ok"]);
    expect(accountant.totals()).toEqual([{ provider: "primary", calls: 1, inputTokens: 10, outputTokens: 5, costEur: 0.02 }]);
  });

  it("fails over to the next provider and audits the failover", async () => {
    const { audits, accountant, reg } = setup();
    reg.register({ provider: fail("primary"), tiers: ["t4"], priority: 0 });
    reg.register({ provider: ok("secondary", 0.03), tiers: ["t4"], priority: 1 });
    const composite = reg.compose({ onAudit: (a) => audits.push(a), accountant });
    const res = await composite.invoke("hi", "t4");
    expect(res.text).toBe("secondary:hi");
    expect(audits.map((a) => `${a.provider}:${a.outcome}`)).toEqual(["primary:error", "secondary:failover"]);
    expect(accountant.totalEur()).toBeCloseTo(0.03);
  });

  it("throws AllProvidersFailedError when every provider fails", async () => {
    const { audits, reg } = setup();
    reg.register({ provider: fail("a"), tiers: ["t4"], priority: 0 });
    reg.register({ provider: fail("b"), tiers: ["t4"], priority: 1 });
    const composite = reg.compose({ onAudit: (a) => audits.push(a) });
    await expect(composite.invoke("x", "t4")).rejects.toBeInstanceOf(AllProvidersFailedError);
    expect(audits.filter((a) => a.outcome === "error")).toHaveLength(2);
  });

  it("opens a provider's circuit after repeated failures and skips it", async () => {
    const { audits, reg } = setup();
    reg.register({ provider: fail("flaky"), tiers: ["t4"], priority: 0 });
    reg.register({ provider: ok("stable"), tiers: ["t4"], priority: 1 });
    const composite = reg.compose({ onAudit: (a) => audits.push(a), circuit: { failureThreshold: 1, resetMs: 60_000 } });
    await composite.invoke("1", "t4"); // flaky fails once → circuit opens
    audits.length = 0;
    await composite.invoke("2", "t4"); // flaky skipped (circuit open), stable serves
    const flaky = audits.find((a) => a.provider === "flaky");
    expect(flaky?.error).toContain("circuit");
  });
});

describe("CostAccountant", () => {
  it("aggregates per-provider totals sorted by name", () => {
    const acc = new CostAccountant();
    acc.record("b", { inputTokens: 1, outputTokens: 2, costEur: 0.01 });
    acc.record("a", { inputTokens: 3, outputTokens: 4, costEur: 0.02 });
    acc.record("a", { inputTokens: 1, outputTokens: 1, costEur: 0.03 });
    expect(acc.totals().map((t) => t.provider)).toEqual(["a", "b"]);
    expect(acc.totals()[0]).toEqual({ provider: "a", calls: 2, inputTokens: 4, outputTokens: 5, costEur: 0.05 });
    expect(acc.totalEur()).toBeCloseTo(0.06);
  });
});
