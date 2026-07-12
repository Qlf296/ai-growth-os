# Migration notes — 20260712000006_signals (ADR-043)

## Intent
Signals store (S3 §4): raw-first ingestion lands normalized rows here; `payload_ref` points to the immutable raw payload; `dedupe_hash` unique per (workspace, occurred_at) makes retries free. RLS + append-only grants (facts don't mutate). DEFAULT partition now; monthly partition automation + 13-month retention arrive with the rollup job (S3 retention plan).

## Rollback
Expand-only. `DROP TABLE signals` (cascades to partitions).

## Backfill
None — ingestion starts empty; provider backfill jobs are a later step.
