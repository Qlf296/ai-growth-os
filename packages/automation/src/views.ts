/** Read models for the automation/experiment UI (STEP 7.6). Repository-only. */
import type pg from "pg";

import { withWorkspace } from "@aigos/database";

export interface RuleView { id: string; name: string; triggerType: string; action: string; ladderLevel: string; enabled: boolean; }
export interface ExecutionView { ruleName: string; status: string; triggerRef: string; executedAt: string; }
export interface ExperimentView {
  id: string; hypothesis: string; expectedImpact: string; confidence: string; metric: string;
  status: string; winnerLabel: string | null; createdAt: string;
  variants: { label: string; mean: number; samples: number }[];
}

export async function listRules(pool: pg.Pool, workspaceId: string): Promise<RuleView[]> {
  const r = await withWorkspace(pool, workspaceId, (tx) => tx.query(`SELECT id, name, trigger, action, ladder_level, enabled FROM automation_rules ORDER BY created_at DESC`));
  return (r.rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string, name: row.name as string,
    triggerType: (row.trigger as { type: string }).type, action: row.action as string,
    ladderLevel: row.ladder_level as string, enabled: row.enabled as boolean,
  }));
}

export async function listExecutions(pool: pg.Pool, workspaceId: string, limit = 20): Promise<ExecutionView[]> {
  const r = await withWorkspace(pool, workspaceId, (tx) =>
    tx.query(`SELECT r.name AS rule_name, e.status, e.trigger_ref, e.executed_at FROM automation_executions e JOIN automation_rules r ON r.id = e.rule_id ORDER BY e.executed_at DESC LIMIT $1`, [limit]),
  );
  return (r.rows as Array<Record<string, unknown>>).map((row) => ({
    ruleName: row.rule_name as string, status: row.status as string, triggerRef: row.trigger_ref as string, executedAt: (row.executed_at as Date).toISOString(),
  }));
}

export async function listExperiments(pool: pg.Pool, workspaceId: string): Promise<ExperimentView[]> {
  return withWorkspace(pool, workspaceId, async (tx) => {
    const exps = await tx.query(`SELECT id, hypothesis, expected_impact, confidence, metric, status, winner_variant_id, created_at FROM experiments ORDER BY created_at DESC`);
    const out: ExperimentView[] = [];
    for (const e of exps.rows as Array<Record<string, unknown>>) {
      const vs = await tx.query(
        `SELECT v.label, coalesce(avg(m.value),0)::float AS mean, count(m.id)::int AS samples, v.id
         FROM experiment_variants v LEFT JOIN experiment_metrics m ON m.variant_id = v.id AND m.metric = $2
         WHERE v.experiment_id = $1 GROUP BY v.id, v.label ORDER BY v.label`,
        [e.id, e.metric],
      );
      const variants = (vs.rows as Array<Record<string, unknown>>).map((v) => ({ label: v.label as string, mean: Number(v.mean), samples: v.samples as number, id: v.id as string }));
      const winner = variants.find((v) => v.id === (e.winner_variant_id as string | null));
      out.push({
        id: e.id as string, hypothesis: e.hypothesis as string, expectedImpact: e.expected_impact as string,
        confidence: e.confidence as string, metric: e.metric as string, status: e.status as string,
        winnerLabel: winner ? winner.label : null, createdAt: (e.created_at as Date).toISOString(),
        variants: variants.map((v) => ({ label: v.label, mean: v.mean, samples: v.samples })),
      });
    }
    return out;
  });
}
