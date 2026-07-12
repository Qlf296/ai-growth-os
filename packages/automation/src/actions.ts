/**
 * Built-in automation actions (STEP 7.4). These execute human-configured rules
 * (Law 16 — the human owns the decision via the rule) and reuse the growth
 * lifecycle (no duplicated workflow). They advance the OPPORTUNITY lifecycle
 * only; they never publish (Law 5 / ADR-048 A3 forbidden). Evidence ids are
 * carried through to the execution result (I4 linkage).
 */
import type pg from "pg";

import { transitionOpportunity } from "@aigos/growth";

import type { ActionHandler, ActionResult } from "./registry.js";

const evidenceOf = (fact: Record<string, unknown>): string[] => {
  const e = fact.evidenceIds;
  return Array.isArray(e) ? (e as string[]) : [];
};

/** detected → validated (a system determination, not a growth commitment). */
export function validateOpportunityAction(pool: pg.Pool): ActionHandler {
  return {
    name: "opportunity.validate",
    publishes: false,
    async run(ctx): Promise<ActionResult> {
      const id = ctx.fact.opportunityId as string;
      const t = await transitionOpportunity(pool, ctx.workspaceId, id, "validated", "automation: validate");
      return { ok: t.changed, detail: { opportunityId: id, from: t.from, to: t.to, evidenceIds: evidenceOf(ctx.fact) } };
    },
  };
}

/** validated → accepted (the human's standing order via the rule; still no publishing). */
export function acceptOpportunityAction(pool: pg.Pool): ActionHandler {
  return {
    name: "opportunity.accept",
    publishes: false,
    async run(ctx): Promise<ActionResult> {
      const id = ctx.fact.opportunityId as string;
      const t = await transitionOpportunity(pool, ctx.workspaceId, id, "accepted", "automation: accept (human-configured rule)");
      return { ok: t.changed, detail: { opportunityId: id, from: t.from, to: t.to, evidenceIds: evidenceOf(ctx.fact) } };
    },
  };
}

import { ActionRegistry } from "./registry.js";

/** A registry pre-loaded with the built-in, non-publishing lifecycle actions. */
export function buildDefaultActionRegistry(pool: pg.Pool): ActionRegistry {
  const r = new ActionRegistry();
  r.register(validateOpportunityAction(pool));
  r.register(acceptOpportunityAction(pool));
  return r;
}
