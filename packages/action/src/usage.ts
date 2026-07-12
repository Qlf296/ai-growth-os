/** AI usage/cost reporting (STEP 6.8) from the llm_calls ledger. Reuses the CostMeter-persisted rows; no recomputation. */
import type pg from "pg";

import { withWorkspace } from "@aigos/database";

export interface UsageSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costEur: number;
  cacheHits: number;
  avgLatencyMs: number | null;
  byProvider: { provider: string; requests: number; costEur: number }[];
  monthly: { month: string; costEur: number; requests: number }[];
  history: { feature: string; provider: string; tier: string; inputTokens: number; outputTokens: number; costEur: number; cached: boolean; latencyMs: number | null; at: string }[];
}

export async function usageSummary(pool: pg.Pool, workspaceId: string, historyLimit = 20): Promise<UsageSummary> {
  return withWorkspace(pool, workspaceId, async (tx) => {
    const agg = await tx.query(
      `SELECT count(*)::int AS requests, coalesce(sum(input_tokens),0)::int AS it, coalesce(sum(output_tokens),0)::int AS ot,
              coalesce(sum(cost_eur),0)::float AS cost, coalesce(sum((cached)::int),0)::int AS cache_hits, avg(latency_ms)::float AS avg_latency
       FROM llm_calls`,
    );
    const prov = await tx.query(`SELECT provider, count(*)::int AS requests, coalesce(sum(cost_eur),0)::float AS cost FROM llm_calls GROUP BY provider ORDER BY provider`);
    const monthly = await tx.query(`SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, coalesce(sum(cost_eur),0)::float AS cost, count(*)::int AS requests FROM llm_calls GROUP BY 1 ORDER BY 1 DESC`);
    const hist = await tx.query(`SELECT feature, provider, tier, input_tokens, output_tokens, cost_eur, cached, latency_ms, created_at FROM llm_calls ORDER BY created_at DESC LIMIT $1`, [historyLimit]);
    const a = agg.rows[0] as Record<string, unknown>;
    return {
      requests: a.requests as number, inputTokens: a.it as number, outputTokens: a.ot as number,
      costEur: a.cost as number, cacheHits: a.cache_hits as number, avgLatencyMs: (a.avg_latency as number | null) ?? null,
      byProvider: (prov.rows as Array<Record<string, unknown>>).map((r) => ({ provider: r.provider as string, requests: r.requests as number, costEur: r.cost as number })),
      monthly: (monthly.rows as Array<Record<string, unknown>>).map((r) => ({ month: r.month as string, costEur: r.cost as number, requests: r.requests as number })),
      history: (hist.rows as Array<Record<string, unknown>>).map((r) => ({
        feature: r.feature as string, provider: r.provider as string, tier: r.tier as string,
        inputTokens: r.input_tokens as number, outputTokens: r.output_tokens as number, costEur: Number(r.cost_eur),
        cached: r.cached as boolean, latencyMs: (r.latency_ms as number | null) ?? null, at: (r.created_at as Date).toISOString(),
      })),
    };
  });
}
