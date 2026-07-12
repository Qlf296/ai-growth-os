/**
 * Raw-first ingestion (S2 §3): store each page immutably FIRST, then validate,
 * normalize and land Signals idempotently (S3 §4). Automatic pagination until a
 * short page completes the date range; re-running is a no-op (raw is immutable,
 * signals dedupe) so interrupted syncs resume without data loss or duplication.
 */
import type pg from "pg";

import { SignalRepository, withWorkspace } from "@aigos/database";
import { rawKey, type RawStore } from "@aigos/infra";

import { toSignalDrafts, validateGscResponse } from "./normalize.js";
import type { GscTransport } from "./transport.js";

const DEFAULT_ROW_LIMIT = 25_000; // GSC per-request maximum

export interface IngestParams {
  readonly pool: pg.Pool;
  readonly rawStore: RawStore;
  readonly transport: GscTransport;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly siteUrl: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly capturedAt: Date;
  readonly rowLimit?: number;
}

export interface IngestResult {
  readonly rawRef: string;    // first page (back-compat)
  readonly rawRefs: string[];
  readonly inserted: number;
  readonly duplicates: number;
  readonly pages: number;
  readonly apiCalls: number;
}

export class GscValidationError extends Error {
  constructor(message: string, readonly rawRef: string) {
    super(message);
    this.name = "GscValidationError";
  }
}

const repo = new SignalRepository();

/** Optional hook fired before every provider page request (quota gate lives here). */
export type BeforeCall = () => Promise<void>;

export async function ingestSearchAnalytics(params: IngestParams, beforeCall?: BeforeCall): Promise<IngestResult> {
  const rowLimit = params.rowLimit ?? DEFAULT_ROW_LIMIT;
  const rawRefs: string[] = [];
  let inserted = 0;
  let duplicates = 0;
  let apiCalls = 0;
  let startRow = 0;

  for (;;) {
    if (beforeCall) await beforeCall();
    apiCalls += 1;
    const payload = await params.transport.querySearchAnalytics({
      siteUrl: params.siteUrl,
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: ["date", "query", "page"],
      rowLimit,
      startRow,
    });

    const rawRef = rawKey({
      workspaceId: params.workspaceId,
      provider: "gsc",
      capturedAt: params.capturedAt,
      id: `${encodeURIComponent(params.siteUrl)}_${params.startDate}_${params.endDate}_${startRow}_${params.capturedAt.getTime()}`,
    });
    // Raw FIRST. A retry that already stored this page is tolerated (first capture wins).
    try {
      await params.rawStore.put(rawRef, Buffer.from(JSON.stringify(payload)));
    } catch (error) {
      if (!(error instanceof Error && /immutable/i.test(error.message))) throw error;
    }
    rawRefs.push(rawRef);

    let rows;
    try {
      rows = validateGscResponse(payload);
    } catch (error) {
      throw new GscValidationError((error as Error).message, rawRef);
    }

    if (rows.length > 0) {
      const page = await withWorkspace(params.pool, params.workspaceId, (tx) =>
        repo.insertMany(tx, toSignalDrafts(rows, params.connectionId, rawRef)),
      );
      inserted += page.inserted;
      duplicates += page.duplicates;
    }

    if (rows.length < rowLimit) break; // short page → range complete
    startRow += rowLimit;
  }

  return { rawRef: rawRefs[0]!, rawRefs, inserted, duplicates, pages: rawRefs.length, apiCalls };
}
