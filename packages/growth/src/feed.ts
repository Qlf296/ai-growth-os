/**
 * Daily Growth Feed (STEP 4.5). Deterministic ordering (priority desc, stable
 * tie-break), grouped by category, paginated. Reads persisted opportunities +
 * recommendations — replay-safe because ordering is a pure function of stored
 * rows.
 */
import type pg from "pg";

import { withWorkspace } from "@aigos/database";

import { rankOpportunities } from "./priority.js";

export interface FeedItem {
  opportunityId: string;
  entity: string;
  category: string;
  severity: string;
  confidence: string;
  impact: string;
  effort: string;
  priorityScore: number;
  status: string;
  recommendation: { title: string; summary: string } | null;
}

export interface Feed {
  day: string;
  page: number;
  pageSize: number;
  total: number;
  groups: Record<string, FeedItem[]>;
  items: FeedItem[];
}

export async function buildFeed(
  pool: pg.Pool,
  workspaceId: string,
  day: string,
  opts: { page?: number; pageSize?: number } = {},
): Promise<Feed> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.max(1, opts.pageSize ?? 3); // 3 by default (S5 §1)
  const rows = await withWorkspace(pool, workspaceId, (tx) =>
    tx.query(
      `SELECT o.id, o.entity, o.category, o.severity, o.confidence, o.impact, o.effort, o.priority_score, o.status,
              r.title AS rec_title, r.summary AS rec_summary
       FROM opportunities o
       LEFT JOIN recommendations r ON r.opportunity_id = o.id
       WHERE o.occurred_on = $1 AND o.status IN ('detected','validated','postponed')`,
      [day],
    ),
  );
  const all: (FeedItem & { id: string })[] = (rows.rows as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    opportunityId: r.id as string,
    entity: r.entity as string,
    category: r.category as string,
    severity: r.severity as string,
    confidence: r.confidence as string,
    impact: r.impact as string,
    effort: r.effort as string,
    priorityScore: Number(r.priority_score),
    status: r.status as string,
    recommendation: r.rec_title ? { title: r.rec_title as string, summary: r.rec_summary as string } : null,
  }));
  const ranked = rankOpportunities(all);
  const total = ranked.length;
  const start = (page - 1) * pageSize;
  const items = ranked.slice(start, start + pageSize);
  const groups: Record<string, FeedItem[]> = {};
  for (const item of items) (groups[item.category] ??= []).push(item);
  return { day, page, pageSize, total, groups, items };
}
