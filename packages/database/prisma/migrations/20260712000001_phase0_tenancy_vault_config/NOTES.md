# Migration notes — 20260712000001_phase0_tenancy_vault_config (ADR-043)

## Intent
Phase 0 substrate: tenancy root (plans/users/workspaces/memberships), connections + token vault (ADR-019, I8), append-only config ledger (ADR-046), audit log. RLS + FORCE on every tenant table, keyed to `current_setting('app.workspace_id', true)` set per transaction (`SET LOCAL`).

## Rollback
Initial migration — rollback = drop schema. No production data exists before this migration; a full `DROP TABLE audit_log, config_overrides, provider_tokens, connections, memberships, workspaces, users, plans` and `DROP ROLE aigos_app, aigos_vault` restores the empty state. No expand/contract pair needed for an initial expand.

## Backfill
None — no pre-existing data.

## Production note (Supabase)
Role passwords here are test-harness values; in Supabase they are managed secrets, and role creation is a one-time provisioning script executed by the platform admin, not by the app. Pooler compatibility: all workspace scoping uses `SET LOCAL` inside explicit transactions — safe under transaction-mode pooling (PgBouncer/Supavisor).
