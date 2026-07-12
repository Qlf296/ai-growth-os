# Migration notes — 20260712000004_seed_plans (ADR-043)

## Intent
Seed the two launch plans (S20). `free` limits per S3 §2 example; `growth` limits deliberately empty — founder ratification required before launch (Law 15 discipline: no invented values).

## Rollback
`DELETE FROM plans WHERE id IN ('free','growth')` (only if no workspace references them).

## Backfill
None.
