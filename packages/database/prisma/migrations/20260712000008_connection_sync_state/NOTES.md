# Migration notes — 20260712000008_connection_sync_state (ADR-043)

## Intent
Per-connection sync metadata for production-ready incremental synchronization (ADR-021 health model): watermark (last_successful_sync) for resume, last_attempted_sync, duration, cumulative imported rows and API quota usage, and last_error. RLS + workspace-scoped; upserted by the app role.

## Rollback
Expand-only. `DROP TABLE connection_sync_state`.

## Backfill
None — rows are created on first sync per connection.
