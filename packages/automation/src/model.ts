/**
 * Automation workflow model (STEP 7.1). Triggers, conditions and actions are
 * DATA. The automation ladder (ADR-048) is bounded to A2: A3/A4 are forbidden
 * indefinitely for content/outreach (Law 5). Automations execute only rules a
 * human configured (Law 16 — the human owns the decision; the rule is their
 * standing, frozen order), and no action may publish.
 */
export type LadderLevel = "A0" | "A1" | "A2";
export const MAX_LADDER: LadderLevel = "A2";
const LADDER_ORDER: Record<LadderLevel, number> = { A0: 0, A1: 1, A2: 2 };

export type Op = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in";

export interface Clause {
  readonly field: string;
  readonly op: Op;
  readonly value: unknown;
}

/** A condition is an AND of clauses over a flat fact object. Deterministic. */
export type Condition = readonly Clause[];

export interface Trigger {
  readonly type: string;              // e.g. "opportunity.detected"
  readonly filter?: Condition;        // optional extra match on the fact
}

export interface AutomationRule {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly trigger: Trigger;
  readonly condition: Condition;
  readonly action: string;            // registered action name
  readonly ladderLevel: LadderLevel;
  readonly enabled: boolean;
}

export function ladderAllowed(level: LadderLevel): boolean {
  return LADDER_ORDER[level] <= LADDER_ORDER[MAX_LADDER];
}

function get(fact: Record<string, unknown>, field: string): unknown {
  return field.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), fact);
}

export function evalClause(fact: Record<string, unknown>, c: Clause): boolean {
  const v = get(fact, c.field);
  switch (c.op) {
    case "eq": return v === c.value;
    case "neq": return v !== c.value;
    case "gt": return typeof v === "number" && v > (c.value as number);
    case "gte": return typeof v === "number" && v >= (c.value as number);
    case "lt": return typeof v === "number" && v < (c.value as number);
    case "lte": return typeof v === "number" && v <= (c.value as number);
    case "in": return Array.isArray(c.value) && (c.value as unknown[]).includes(v);
    default: return false;
  }
}

export function evalCondition(fact: Record<string, unknown>, condition: Condition): boolean {
  return condition.every((c) => evalClause(fact, c));
}

/** Does the rule's trigger match this fact? (type + optional filter) */
export function triggerMatches(rule: AutomationRule, triggerType: string, fact: Record<string, unknown>): boolean {
  if (rule.trigger.type !== triggerType) return false;
  if (rule.trigger.filter && !evalCondition(fact, rule.trigger.filter)) return false;
  return true;
}
