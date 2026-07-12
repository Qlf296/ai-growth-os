# Migration notes — 20260712000003_auth_sessions (ADR-043)

## Intent
Passwordless auth foundation (ADR-016) + server-side rotating sessions (ADR-017). Global identity tables (pre-workspace): magic_link_tokens (hashed, single-use, UA-bound), sessions (opaque id, rotating refresh with family invalidation, instant revocation).

## Rollback
Expand-only. `DROP TABLE sessions, magic_link_tokens` — nothing else depends on them.

## Backfill
None — tables start empty.
