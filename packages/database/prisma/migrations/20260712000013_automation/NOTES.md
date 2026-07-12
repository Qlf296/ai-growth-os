# Migration notes — 20260712000013_automation (ADR-043)

## Intent
Automation rules as data (triggers/conditions/actions) bounded to the ADR-048 ladder (A0–A2 only; A3/A4 forbidden by CHECK). created_by records the human who configured the rule (Law 16). automation_executions is the idempotent, append-only execution history.

## Rollback
Expand-only. DROP TABLE automation_executions, automation_rules; -- contract:

## Backfill
None — rules are created by workspace owners.
