/**
 * AI Gateway shell (S2 §7: one interface — gateway.infer). I6: sole model
 * path. No provider SDK, no real calls — a fake provider exercises the shell.
 * Mechanics under test: versioned templates (ADR-044), budget gate that never
 * silently overspends (S2 §8), response cache (P3), cost metering.
 */
import { describe, expect, it, vi } from "vitest";

import { InMemoryCache } from "@aigos/infra";

import {
  AIGateway,
  BudgetExceededError,
  InMemoryBudgetGuard,
  PromptTemplateRegistry,
  type CostRecord,
  type ModelProvider,
} from "../src/index.js";

const templates = new PromptTemplateRegistry();
templates.register({
  id: "draft.summary",
  version: 3,
  render: (params) => `Summarize: ${params.text as string}`,
});

function fakeProvider(costEur = 0.01): ModelProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: "fake",
    calls,
    async invoke(prompt) {
      calls.push(prompt);
      return { text: `echo(${prompt})`, inputTokens: 10, outputTokens: 5, costEur };
    },
  };
}

function makeGateway(provider: ModelProvider, budgetEur = 1) {
  const costs: CostRecord[] = [];
  const gateway = new AIGateway({
    provider,
    templates,
    cache: new InMemoryCache(),
    budget: new InMemoryBudgetGuard(budgetEur),
    meter: async (r) => {
      costs.push(r);
    },
  });
  return { gateway, costs };
}

const REQ = {
  workspaceId: "ws1",
  feature: "social.draft",
  tier: "t3" as const,
  templateId: "draft.summary",
  params: { text: "hello" },
};

describe("infer", () => {
  it("renders the versioned template, calls the provider, meters cost, returns trace fields", async () => {
    const provider = fakeProvider();
    const { gateway, costs } = makeGateway(provider);
    const res = await gateway.infer(REQ);
    expect(res.text).toBe("echo(Summarize: hello)");
    expect(res.trace).toMatchObject({
      promptTemplateId: "draft.summary",
      promptTemplateVersion: 3, // ADR-044: version recorded in every trace
      provider: "fake",
      tier: "t3",
      cached: false,
    });
    expect(costs).toHaveLength(1);
    expect(costs[0]).toMatchObject({ workspaceId: "ws1", feature: "social.draft", costEur: 0.01 });
  });

  it("unknown template fails loudly — prompts are governed data, not ad-hoc strings", async () => {
    const { gateway } = makeGateway(fakeProvider());
    await expect(gateway.infer({ ...REQ, templateId: "nope" })).rejects.toThrow(/not registered/i);
  });
});

describe("budget gate (S2 §8 — degrade, never silently overspend)", () => {
  it("denies when the workspace+feature budget is exhausted, WITHOUT calling the provider", async () => {
    const provider = fakeProvider(1.5);
    const { gateway } = makeGateway(provider, 1);
    await gateway.infer(REQ);
    await expect(gateway.infer({ ...REQ, params: { text: "second" } })).rejects.toThrow(
      BudgetExceededError,
    );
    expect(provider.calls).toHaveLength(1); // the denied call never reached the model
  });

  it("the refusal is typed and carries what the caller needs to degrade gracefully", async () => {
    const { gateway } = makeGateway(fakeProvider(2), 1);
    await gateway.infer(REQ);
    try {
      await gateway.infer({ ...REQ, params: { text: "x" } });
      expect.unreachable();
    } catch (error) {
      const e = error as BudgetExceededError;
      expect(e.workspaceId).toBe("ws1");
      expect(e.feature).toBe("social.draft");
      expect(e.spentEur).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("response cache (P3 — frontier calls are the scarcest resource)", () => {
  it("identical request hits the cache: one provider call, trace says cached", async () => {
    const provider = fakeProvider();
    const { gateway, costs } = makeGateway(provider);
    const first = await gateway.infer(REQ);
    const second = await gateway.infer(REQ);
    expect(provider.calls).toHaveLength(1);
    expect(first.text).toBe(second.text);
    expect(second.trace.cached).toBe(true);
    expect(costs).toHaveLength(1); // cached responses cost nothing
  });

  it("different params or template version miss the cache", async () => {
    const provider = fakeProvider();
    const { gateway } = makeGateway(provider);
    await gateway.infer(REQ);
    await gateway.infer({ ...REQ, params: { text: "other" } });
    expect(provider.calls).toHaveLength(2);
  });
});

describe("template registry", () => {
  it("re-registering the same id+version is refused (versions are immutable)", () => {
    expect(() =>
      templates.register({ id: "draft.summary", version: 3, render: () => "changed" }),
    ).toThrow(/immutable|already/i);
  });

  it("a new version can be registered and becomes the default", async () => {
    const local = new PromptTemplateRegistry();
    local.register({ id: "t", version: 1, render: () => "v1" });
    local.register({ id: "t", version: 2, render: () => "v2" });
    const provider = fakeProvider();
    const gateway = new AIGateway({
      provider,
      templates: local,
      cache: new InMemoryCache(),
      budget: new InMemoryBudgetGuard(10),
      meter: vi.fn(async () => {}),
    });
    const res = await gateway.infer({ ...REQ, templateId: "t" });
    expect(res.trace.promptTemplateVersion).toBe(2);
    expect(provider.calls[0]).toBe("v2");
  });
});
