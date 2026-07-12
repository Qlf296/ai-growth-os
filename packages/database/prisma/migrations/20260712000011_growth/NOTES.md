# Migration notes — 20260712000011_growth (ADR-043)

## Intent
Phase 4 Growth Intelligence: opportunities (grouped per-page findings, ADR-031; deterministic priority_score + score_trace; honest impact/effort/ROI, Law 15/ADR-034) with a lifecycle status, and data-only recommendations. RLS + workspace-scoped; opportunities updatable (lifecycle), recommendations append-only.

## Rollback
Expand-only. DROP TABLE recommendations, opportunities; -- contract:

## Backfill
None — populated by the growth build job from detector findings.
