/**
 * Cost & Budget persistence (STEP 5.3). Reuses the AI Gateway CostMeter port to
 * persist every model call to the llm_calls ledger (S3 §9) and to capture the
 * usage for the draft row. Latency/cached/status are recorded per call.
 */
import type pg from "pg";

import type { CostMeter, CostRecord } from "@aigos/ai-gateway";
import { withWorkspace } from "@aigos/database";

export interface CapturedUsage {
  inputTokens: number;
  outputTokens: number;
  costEur: number;
  provider: string;
  tier: string;
}

/** A CostMeter that both persists to llm_calls and captures the last usage. */
export function pgCostMeter(pool: pg.Pool, workspaceId: string, capture: { latencyMs?: number; cached?: boolean }): {
  meter: CostMeter;
  usage: () => CapturedUsage | null;
} {
  let last: CapturedUsage | null = null;
  const meter: CostMeter = async (r: CostRecord) => {
    last = { inputTokens: r.inputTokens, outputTokens: r.outputTokens, costEur: r.costEur, provider: r.provider, tier: r.tier };
    await withWorkspace(pool, workspaceId, (tx) =>
      tx.query(
        `INSERT INTO llm_calls (workspace_id, feature, tier, provider, input_tokens, output_tokens, cost_eur, latency_ms, cached, status)
         VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, 'ok')`,
        [r.feature, r.tier, r.provider, r.inputTokens, r.outputTokens, r.costEur, capture.latencyMs ?? null, capture.cached ?? false],
      ),
    );
  };
  return { meter, usage: () => last };
}
