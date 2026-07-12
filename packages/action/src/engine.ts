/**
 * Draft Generation Engine (STEP 5.1). Turns a validated recommendation into a
 * structured draft via the AI Gateway ONLY (I6/AT-6 — no direct provider
 * access). Persists the draft with its recommendation + evidence references,
 * prompt template version (ADR-044), model metadata, cost/tokens/latency, trace
 * id and generation timestamp. Never publishes (Law 5).
 */
import { randomUUID } from "node:crypto";

import { AIGateway, type BudgetGuard, type ModelProvider } from "@aigos/ai-gateway";
import { PromptTemplateRegistry } from "@aigos/ai-gateway";
import type { Cache } from "@aigos/infra";
import { withWorkspace } from "@aigos/database";
import type pg from "pg";

import { pgCostMeter } from "./cost-meter.js";
import { templateIdFor, type DraftType } from "./templates.js";

export interface DraftEngineDeps {
  readonly pool: pg.Pool;
  readonly provider: ModelProvider;
  readonly templates: PromptTemplateRegistry;
  readonly cache: Cache;
  readonly budget: BudgetGuard;
  readonly tier?: "t3" | "t4";
  readonly clock?: () => Date;
}

export interface GeneratedDraft {
  id: string;
  draftType: DraftType;
  content: string;
  promptTemplateVersion: number;
  provider: string;
  cached: boolean;
  costEur: number;
  traceId: string;
}

export async function generateDraft(
  deps: DraftEngineDeps,
  workspaceId: string,
  recommendationId: string,
  draftType: DraftType,
): Promise<GeneratedDraft> {
  const rec = await withWorkspace(deps.pool, workspaceId, (tx) =>
    tx.query(
      `SELECT r.summary, r.business_reason, r.technical_reason, r.expected_impact, r.steps, r.evidence_ids, o.entity
       FROM recommendations r JOIN opportunities o ON o.id = r.opportunity_id
       WHERE r.id = $1`,
      [recommendationId],
    ),
  );
  if (!rec.rowCount) throw new Error(`recommendation not found: ${recommendationId}`);
  const row = rec.rows[0] as Record<string, unknown>;
  const params = {
    entity: row.entity, summary: row.summary, businessReason: row.business_reason,
    technicalReason: row.technical_reason, expectedImpact: row.expected_impact, steps: row.steps,
  };

  const { meter, usage } = pgCostMeter(deps.pool, workspaceId, {});
  const gateway = new AIGateway({ provider: deps.provider, templates: deps.templates, cache: deps.cache, budget: deps.budget, meter });

  const startedAt = Date.now();
  const result = await gateway.infer({
    workspaceId, feature: `draft.${draftType}`, tier: deps.tier ?? "t3",
    templateId: templateIdFor(draftType), params,
  });
  const latencyMs = Date.now() - startedAt;
  const u = usage();
  const traceId = randomUUID();
  const evidenceIds = row.evidence_ids as unknown[];

  const draft = await withWorkspace(deps.pool, workspaceId, (tx) =>
    tx.query(
      `INSERT INTO drafts
         (workspace_id, recommendation_id, draft_type, content, prompt_template_id, prompt_template_version, provider, tier, cached, trace_id, input_tokens, output_tokens, cost_eur, latency_ms, evidence_ids, status)
       VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, 'draft')
       RETURNING id`,
      [recommendationId, draftType, result.text, result.trace.promptTemplateId, result.trace.promptTemplateVersion,
       result.trace.provider, result.trace.tier, result.trace.cached, traceId,
       u?.inputTokens ?? 0, u?.outputTokens ?? 0, u?.costEur ?? 0, latencyMs, JSON.stringify(evidenceIds)],
    ),
  );

  return {
    id: (draft.rows[0] as { id: string }).id,
    draftType,
    content: result.text,
    promptTemplateVersion: result.trace.promptTemplateVersion,
    provider: result.trace.provider,
    cached: result.trace.cached,
    costEur: u?.costEur ?? 0,
    traceId,
  };
}
