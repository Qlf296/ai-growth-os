# Migration notes — 20260712000005_user_scope_policies (ADR-043)

## Intent
User-scoped READ visibility on memberships/workspaces (`app.user_id`, SET LOCAL): a user lists their own workspaces (S6 §3 signup/login flow). Writes remain workspace-scoped only (WITH CHECK unchanged). No cross-user visibility: the predicate binds strictly to the requesting user id.

## Rollback
Recreate the previous single-scope policies (see migration 0001) — policy swap, no data movement.

## Backfill
None — policies only.
