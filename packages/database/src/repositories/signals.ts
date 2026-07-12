/** Signals — immutable facts (S3 §4). One writer path: adapter ingestion. */
import type { Tx } from "../tenancy.js";

export interface SignalDraft {
  readonly connectionId: string;
  readonly source: string;
  readonly type: string;
  readonly externalId: string;
  readonly occurredAt: Date;
  readonly payloadRef: string;
  readonly data: Record<string, unknown>;
  readonly normalizerVersion: number;
  readonly dedupeHash: string;
}

export class SignalRepository {
  /** Idempotent batch insert — duplicates (dedupe_hash) are skipped, not errors. */
  async insertMany(tx: Tx, drafts: readonly SignalDraft[]): Promise<{ inserted: number; duplicates: number }> {
    let inserted = 0;
    for (const d of drafts) {
      const r = await tx.query(
        `INSERT INTO signals (workspace_id, connection_id, source, type, external_id, occurred_at, payload_ref, data, normalizer_version, dedupe_hash)
         VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
         ON CONFLICT (workspace_id, dedupe_hash, occurred_at) DO NOTHING`,
        [d.connectionId, d.source, d.type, d.externalId, d.occurredAt, d.payloadRef, JSON.stringify(d.data), d.normalizerVersion, d.dedupeHash],
      );
      inserted += r.rowCount ?? 0;
    }
    return { inserted, duplicates: drafts.length - inserted };
  }
}

export interface SignalRow {
  occurredAt: Date;
  type: string;
  data: Record<string, unknown>;
}

/** Read signals of a type within [from, to] for the CURRENT workspace scope (RLS). */
export async function readSignalsByType(
  tx: import("../tenancy.js").Tx,
  type: string,
  from: Date,
  to: Date,
): Promise<SignalRow[]> {
  const r = await tx.query(
    `SELECT occurred_at, type, data FROM signals
     WHERE type = $1 AND occurred_at >= $2 AND occurred_at <= $3
     ORDER BY occurred_at`,
    [type, from, to],
  );
  return r.rows.map((row: Record<string, unknown>) => ({
    occurredAt: row.occurred_at as Date,
    type: row.type as string,
    data: row.data as Record<string, unknown>,
  }));
}
