# Migration notes — 20260712000002_scheduled_jobs (ADR-043)

## Intent
Scheduler-as-data (ADR-003): recurring job definitions live in Postgres, visible and auditable; the worker enqueues due jobs onto the queue with idempotent keys.

## Rollback
Expand-only migration. Rollback = `DROP TABLE scheduled_jobs` (no other object depends on it).

## Backfill
None — table starts empty; system jobs are seeded by ops, per-workspace jobs materialize from plans.limits on plan change (Phase 1).
