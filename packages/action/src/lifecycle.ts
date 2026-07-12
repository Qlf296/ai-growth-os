/**
 * Human approval workflow (STEP 5.4). draft → reviewed → approved → published,
 * with rejected/regenerated branches. Every transition is audited. There is no
 * automatic publishing (Law 5 / ADR-048): 'published' is a recorded human act.
 */
import type pg from "pg";

import { withWorkspace } from "@aigos/database";

export type DraftStatus = "draft" | "reviewed" | "approved" | "rejected" | "regenerated" | "published";

const ALLOWED: Record<DraftStatus, readonly DraftStatus[]> = {
  draft: ["reviewed", "rejected", "regenerated"],
  reviewed: ["approved", "rejected", "regenerated"],
  approved: ["published", "rejected"],
  regenerated: ["reviewed", "rejected"],
  rejected: [],
  published: [],
};

export interface DraftTransition {
  changed: boolean;
  from: DraftStatus;
  to: DraftStatus;
}

export async function transitionDraft(
  pool: pg.Pool,
  workspaceId: string,
  draftId: string,
  to: DraftStatus,
  actor: string,
  reason: string,
): Promise<DraftTransition> {
  return withWorkspace(pool, workspaceId, async (tx) => {
    const cur = await tx.query(`SELECT status FROM drafts WHERE id = $1`, [draftId]);
    if (!cur.rowCount) throw new Error(`draft not found: ${draftId}`);
    const from = (cur.rows[0] as { status: DraftStatus }).status;
    if (from === to) return { changed: false, from, to };
    if (!ALLOWED[from].includes(to)) throw new Error(`illegal draft transition ${from} → ${to}`);
    await tx.query(`UPDATE drafts SET status = $2, updated_at = now() WHERE id = $1`, [draftId, to]);
    await tx.query(
      `INSERT INTO audit_log (workspace_id, actor, event, details) VALUES ($1, $2, 'draft.transition', $3::jsonb)`,
      [workspaceId, actor, JSON.stringify({ draftId, from, to, reason })],
    );
    return { changed: true, from, to };
  });
}
