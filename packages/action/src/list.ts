/** Draft listing for the Action Center (STEP 6.3). Repository-only read. */
import type pg from "pg";

import { withWorkspace } from "@aigos/database";

export interface DraftListItem {
  id: string;
  draftType: string;
  status: string;
  content: string;
  recommendationTitle: string | null;
  entity: string | null;
  provider: string;
  tier: string;
  inputTokens: number;
  outputTokens: number;
  costEur: number;
  cached: boolean;
  evidenceCount: number;
  createdAt: string;
}

export async function listDrafts(pool: pg.Pool, workspaceId: string): Promise<DraftListItem[]> {
  const r = await withWorkspace(pool, workspaceId, (tx) =>
    tx.query(
      `SELECT d.id, d.draft_type, d.status, d.content, d.provider, d.tier, d.input_tokens, d.output_tokens, d.cost_eur, d.cached, d.evidence_ids, d.created_at,
              r.title AS rec_title, o.entity
       FROM drafts d
       JOIN recommendations r ON r.id = d.recommendation_id
       JOIN opportunities o ON o.id = r.opportunity_id
       ORDER BY d.created_at DESC`,
    ),
  );
  return (r.rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    draftType: row.draft_type as string,
    status: row.status as string,
    content: row.content as string,
    recommendationTitle: (row.rec_title as string | null) ?? null,
    entity: (row.entity as string | null) ?? null,
    provider: row.provider as string,
    tier: row.tier as string,
    inputTokens: row.input_tokens as number,
    outputTokens: row.output_tokens as number,
    costEur: Number(row.cost_eur),
    cached: row.cached as boolean,
    evidenceCount: (row.evidence_ids as unknown[]).length,
    createdAt: (row.created_at as Date).toISOString(),
  }));
}
