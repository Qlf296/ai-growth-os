# Migration notes — 20260712000014_experiments (ADR-043)

## Intent
Experiment Engine (Phase 7.2): experiments with lifecycle (running/completed/archived), variants, deterministic per-unit assignments (UNIQUE(experiment,unit)), and metrics. Winner recorded on decision. RLS + workspace-scoped; append-only variants/assignments/metrics.

## Rollback
Expand-only. DROP TABLE experiment_metrics, experiment_assignments, experiment_variants, experiments; -- contract:

## Backfill
None.
