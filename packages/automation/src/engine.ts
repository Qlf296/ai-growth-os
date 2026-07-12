/**
 * Automation executor (STEP 7.1 core; DB wiring in 7.3). Given a trigger event
 * (type + fact) and the workspace's enabled rules, runs matching rules whose
 * condition passes and whose ladder is permitted — idempotently. Publishing is
 * structurally impossible (registry refuses publishing actions).
 */
import { ActionRegistry } from "./registry.js";
import { ladderAllowed, triggerMatches, evalCondition, type AutomationRule } from "./model.js";

export interface ExecutionRecord {
  ruleId: string;
  status: "ok" | "skipped" | "error";
  detail: Record<string, unknown>;
}

export interface EvaluateOptions {
  /** Idempotency check: has (ruleId, triggerRef) already run? */
  alreadyExecuted?: (ruleId: string) => Promise<boolean>;
}

export async function evaluateRules(
  registry: ActionRegistry,
  rules: readonly AutomationRule[],
  triggerType: string,
  fact: Record<string, unknown>,
  workspaceId: string,
  options: EvaluateOptions = {},
): Promise<ExecutionRecord[]> {
  const out: ExecutionRecord[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!triggerMatches(rule, triggerType, fact)) continue;
    if (!ladderAllowed(rule.ladderLevel)) {
      out.push({ ruleId: rule.id, status: "error", detail: { reason: "ladder_forbidden", level: rule.ladderLevel } });
      continue;
    }
    if (!evalCondition(fact, rule.condition)) {
      out.push({ ruleId: rule.id, status: "skipped", detail: { reason: "condition_false" } });
      continue;
    }
    if (options.alreadyExecuted && (await options.alreadyExecuted(rule.id))) {
      out.push({ ruleId: rule.id, status: "skipped", detail: { reason: "already_executed" } });
      continue;
    }
    try {
      const result = await registry.resolve(rule.action).run({ workspaceId, fact });
      out.push({ ruleId: rule.id, status: result.ok ? "ok" : "error", detail: result.detail });
    } catch (error) {
      out.push({ ruleId: rule.id, status: "error", detail: { error: error instanceof Error ? error.message : String(error) } });
    }
  }
  return out;
}
