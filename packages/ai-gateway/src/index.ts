/** @aigos/ai-gateway — I6: the ONLY path to any model (AT-6 enforces). Shell: no SDK, no real calls yet. */
export { AIGateway } from "./gateway.js";
export type { GatewayDeps } from "./gateway.js";
export { PromptTemplateRegistry } from "./templates.js";
export type { PromptTemplate } from "./templates.js";
export { InMemoryBudgetGuard } from "./budget.js";
export { BudgetExceededError } from "./types.js";
export type {
  BudgetGuard,
  CostMeter,
  CostRecord,
  InferRequest,
  InferResponse,
  InferTrace,
  ModelProvider,
  ModelTier,
} from "./types.js";
export { ProviderRegistry, CostAccountant, AllProvidersFailedError } from "./registry.js";
export type { ProviderEntry, ProviderAudit, ProviderOutcome, ProviderCost, ComposeOptions } from "./registry.js";
