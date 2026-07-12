# Migration notes — 20260712000015_outcomes (ADR-043)

## Intent
Outcome evaluations (S3 §7 closed loop): one append-only row per measurement carrying baseline (snapshotted at subject creation), observed value, window, verdict (met/partial/not_met/unmeasurable — 'unmeasurable' is honest, ADR-025) and a mandatory evidence reference (I4). Idempotent per (workspace, dedupe_hash). Measured units only (Law 15/ADR-034).

## Rollback
Expand-only. DROP TABLE outcome_evaluations; -- contract:

## Backfill
None — populated by the outcomes.evaluate job.
