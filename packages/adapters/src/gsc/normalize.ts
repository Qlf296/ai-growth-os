/**
 * Raw GSC response → validated rows → Signal drafts (S3 §4).
 * Validation is loud; the raw payload was already stored (raw-first).
 */
import { createHash } from "node:crypto";

import type { SignalDraft } from "@aigos/database";

export const GSC_SIGNAL_TYPE = "gsc.search_analytics.daily";
export const GSC_NORMALIZER_VERSION = 1;

export interface GscRow {
  readonly date: string;
  readonly query: string;
  readonly page: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;
  readonly position: number;
}

export interface GscSite {
  readonly siteUrl: string;
  readonly permissionLevel: string;
}

/** Verified properties only — a user cannot connect a property they don't own/manage. */
export function validateSitesResponse(payload: unknown): GscSite[] {
  if (typeof payload !== "object" || payload === null) throw new Error("GSC sites validation failed: not an object");
  const entries = (payload as { siteEntry?: unknown }).siteEntry;
  if (!Array.isArray(entries)) return [];
  return (entries as { siteUrl?: unknown; permissionLevel?: unknown }[])
    .filter((e) => typeof e.siteUrl === "string" && typeof e.permissionLevel === "string" && e.permissionLevel !== "siteUnverifiedUser")
    .map((e) => ({ siteUrl: e.siteUrl as string, permissionLevel: e.permissionLevel as string }));
}

export function validateGscResponse(payload: unknown): GscRow[] {
  const fail = (why: string): never => {
    throw new Error(`GSC response validation failed: ${why}`);
  };
  if (typeof payload !== "object" || payload === null) fail("not an object");
  const rows = (payload as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) fail("missing rows[]");
  return (rows as unknown[]).map((row, i) => {
    const r = row as { keys?: unknown[]; clicks?: unknown; impressions?: unknown; ctr?: unknown; position?: unknown };
    const [date, query, page] = (Array.isArray(r.keys) ? r.keys : fail(`row ${i}: missing keys`)) as string[];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) fail(`row ${i}: bad date`);
    for (const [name, v] of [["clicks", r.clicks], ["impressions", r.impressions], ["ctr", r.ctr], ["position", r.position]] as const) {
      if (typeof v !== "number" || Number.isNaN(v)) fail(`row ${i}: ${name} is not a number`);
    }
    if (typeof query !== "string" || typeof page !== "string") fail(`row ${i}: bad dimensions`);
    return {
      date: date!, query: query!, page: page!,
      clicks: r.clicks as number, impressions: r.impressions as number,
      ctr: r.ctr as number, position: r.position as number,
    };
  });
}

export function toSignalDrafts(rows: readonly GscRow[], connectionId: string, payloadRef: string): SignalDraft[] {
  return rows.map((row) => {
    const externalId = `${row.date}|${row.query}|${row.page}`;
    return {
      connectionId,
      source: "gsc",
      type: GSC_SIGNAL_TYPE,
      externalId,
      occurredAt: new Date(`${row.date}T00:00:00Z`),
      payloadRef,
      data: { query: row.query, page: row.page, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position },
      normalizerVersion: GSC_NORMALIZER_VERSION,
      dedupeHash: createHash("sha256").update(`gsc|${GSC_SIGNAL_TYPE}|${externalId}`).digest("hex"),
    };
  });
}
