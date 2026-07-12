/** @aigos/automation — automation workflow model, registry, executor (Phase 7). */
export { evalCondition, evalClause, triggerMatches, ladderAllowed, MAX_LADDER } from "./model.js";
export type { AutomationRule, Clause, Condition, LadderLevel, Op, Trigger } from "./model.js";
export { ActionRegistry } from "./registry.js";
export type { ActionContext, ActionHandler, ActionResult } from "./registry.js";
export { evaluateRules } from "./engine.js";
export type { EvaluateOptions, ExecutionRecord } from "./engine.js";
