# Migration notes — 20260712000010_detection (ADR-043)

## Intent
Phase 3 signal intelligence: evidence (ADR-035, I4), rules-as-data (S3 §5, detector_rules with global+workspace override), detector_findings (append-only, idempotent), detector_runs (execution history/replay). RLS + append-only grants. Seeds global default detector rules.

## Rollback
Expand-only. DROP TABLE detector_runs, detector_findings, detector_rules, evidence; -- contract:

## Backfill
Global default rules seeded here; workspace overrides created on demand. Findings/evidence populate as detectors run.
