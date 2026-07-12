# Migration notes — 20260712000009_connection_health (ADR-043)

## Intent
Add connections.health_status (pending|healthy|degraded|reconnect_required|failed) for the connection health-monitoring lifecycle (ADR-021). Distinct from connections.status (S3 §3 credential lifecycle). Default 'pending' for existing/new rows.

## Rollback
Expand-only. `ALTER TABLE connections DROP COLUMN health_status; -- contract:`

## Backfill
Existing connections default to 'pending'; the monitor promotes them on first check.
