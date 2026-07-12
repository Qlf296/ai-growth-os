# Migration notes — 20260712000016_outcome_grade (ADR-043)

## Intent
Add outcome_evaluations.grade (ADR-033 attribution grade A/B+/B/C/F). Nullable; set at measurement time by the grader rule. Learning weights follow the grade.

## Rollback
Expand-only. ALTER TABLE outcome_evaluations DROP COLUMN grade; -- contract:

## Backfill
Existing rows keep NULL grade; regraded on next measurement.
