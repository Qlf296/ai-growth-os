/**
 * gateway.infer — the one interface (S2 §7). Pipeline:
 * template → budget gate → cache → provider → meter.
 * Every response carries its trace fields (ADR-044). No business logic here;
 * consumers decide what to do with text, the gateway only governs the call.
 */
import { createHash } from "node:crypto";

import type { Cache } from "@aigos/infra";

import type { PromptTemplateRegistry } from "./templates.js";
import {
  BudgetExceededError,
  type BudgetGuard,
  type CostMeter,
  type InferRequest,
  type InferResponse,
  type ModelProvider,
} from "./types.js";

const CACHE_TTL_SECONDS = 24 * 3600; // response cache (P3); tunable via config registry when consumers land

export interface GatewayDeps {
  readonly provider: ModelProvider;
  readonly templates: PromptTemplateRegistry;
  readonly cache: Cache;
  readonly budget: BudgetGuard;
  readonly meter: CostMeter;
}

export class AIGateway {
  constructor(private readonly deps: GatewayDeps) {}

  async infer(request: InferRequest): Promise<InferResponse> {
    const template = this.deps.templates.resolve(request.templateId);
    const prompt = template.render(request.params);

    const { allowed, spentEur } = await this.deps.budget.check(request.workspaceId, request.feature);
    if (!allowed) {
      throw new BudgetExceededError(request.workspaceId, request.feature, spentEur);
    }

    const trace = {
      promptTemplateId: template.id,
      promptTemplateVersion: template.version,
      provider: this.deps.provider.name,
      tier: request.tier,
    };

    const cacheKey =
      "gw:" +
      createHash("sha256")
        .update(JSON.stringify([template.id, template.version, this.deps.provider.name, request.tier, prompt]))
        .digest("hex");
    const hit = await this.deps.cache.get(cacheKey);
    if (hit !== null) {
      return { text: hit, trace: { ...trace, cached: true } };
    }

    const result = await this.deps.provider.invoke(prompt, request.tier);
    await this.deps.budget.record(request.workspaceId, request.feature, result.costEur);
    await this.deps.meter({
      workspaceId: request.workspaceId,
      feature: request.feature,
      tier: request.tier,
      provider: this.deps.provider.name,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costEur: result.costEur,
      at: new Date().toISOString(),
    });
    await this.deps.cache.set(cacheKey, result.text, CACHE_TTL_SECONDS);
    return { text: result.text, trace: { ...trace, cached: false } };
  }
}
