/**
 * Raw-first ingestion (S2 §3): store the payload immutably FIRST, then
 * validate, normalize and land Signals idempotently (S3 §4).
 */
import type pg from "pg";

import { SignalRepository, withWorkspace } from "@aigos/database";
import { rawKey, type RawStore } from "@aigos/infra";

import { toSignalDrafts, validateGscResponse } from "./normalize.js";
import type { GscTransport } from "./transport.js";

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
}

export interface IngestResult {
  readonly rawRef: string;
  readonly inserted: number;
  readonly duplicates: number;
}

export class GscValidationError extends Error {
  constructor(message: string, readonly rawRef: string) {
    super(message);
    this.name = "GscValidationError";
  }
}

const repo = new SignalRepository();

export async function ingestSearchAnalytics(params: IngestParams): Promise<IngestResult> {
  const payload = await params.transport.querySearchAnalytics({
    siteUrl: params.siteUrl,
    startDate: params.startDate,
    endDate: params.endDate,
    dimensions: ["date", "query", "page"],
  });

  const rawRef = rawKey({
    workspaceId: params.workspaceId,
    provider: "gsc",
    capturedAt: params.capturedAt,
    id: `${encodeURIComponent(params.siteUrl)}_${params.startDate}_${params.endDate}_${params.capturedAt.getTime()}`,
  });
  await params.rawStore.put(rawRef, Buffer.from(JSON.stringify(payload))); // raw FIRST

  let rows;
  try {
    rows = validateGscResponse(payload);
  } catch (error) {
    throw new GscValidationError((error as Error).message, rawRef);
  }

  const drafts = toSignalDrafts(rows, params.connectionId, rawRef);
  const { inserted, duplicates } = await withWorkspace(params.pool, params.workspaceId, (tx) =>
    repo.insertMany(tx, drafts),
  );
  return { rawRef, inserted, duplicates };
}
