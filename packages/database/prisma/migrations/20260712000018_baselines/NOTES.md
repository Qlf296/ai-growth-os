# Migration notes — 20260712000018_baselines (ADR-043)

## Intent
Immutable opportunity baselines (S3 §7): the metric value snapshotted when the opportunity is created, so "action worked" is distinguishable from "trend continued". Write-once (INSERT-only grant, UNIQUE per opportunity+metric), deterministic snapshot_hash for replay safety, RLS.

## Rollback
Expand-only. DROP TABLE opportunity_baselines; -- contract:

## Backfill
None — captured at opportunity creation going forward.
