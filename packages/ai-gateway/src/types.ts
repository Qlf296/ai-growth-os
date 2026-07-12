/** AI Gateway shell — I6: the sole model path. Tiers 3–4 of the ladder (ADR-009/011). */

export type ModelTier = "t3" | "t4";

export interface InferRequest {
  readonly workspaceId: string;
  readonly feature: string;                       // budget + ledger dimension (S3 §9)
  readonly tier: ModelTier;
  readonly templateId: string;                    // prompts are governed data
  readonly params: Record<string, unknown>;
}

export interface InferTrace {
  readonly promptTemplateId: string;
  readonly promptTemplateVersion: number;         // ADR-044: recorded in every trace
  readonly provider: string;
  readonly tier: ModelTier;
  readonly cached: boolean;
}

export interface InferResponse {
  readonly text: string;
  readonly trace: InferTrace;
}

/** Provider-agnostic port. SDK imports live in driver files inside THIS package only (AT-6). */
export interface ModelProvider {
  readonly name: string;
  invoke(prompt: string, tier: ModelTier): Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
    costEur: number;
  }>;
}

export interface CostRecord {
  readonly workspaceId: string;
  readonly feature: string;
  readonly tier: ModelTier;
  readonly provider: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costEur: number;
  readonly at: string;
}

/** Persists to the llm ledger (S3 §9) — wired to Postgres with the ledger table (Phase 1). */
export type CostMeter = (record: CostRecord) => Promise<void>;

/** Budget gate (S2 §8): checked BEFORE the model call; deny = typed error, never silent overspend. */
export interface BudgetGuard {
  check(workspaceId: string, feature: string): Promise<{ allowed: boolean; spentEur: number }>;
  record(workspaceId: string, feature: string, costEur: number): Promise<void>;
}

export class BudgetExceededError extends Error {
  constructor(
    readonly workspaceId: string,
    readonly feature: string,
    readonly spentEur: number,
  ) {
    super(
      `LLM budget exceeded for ${workspaceId}/${feature} (spent €${spentEur.toFixed(2)}) — degrade gracefully, never silently overspend (S2 §8)`,
    );
    this.name = "BudgetExceededError";
  }
}
