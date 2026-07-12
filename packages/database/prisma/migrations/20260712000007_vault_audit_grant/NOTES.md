# Migration notes — 20260712000007_vault_audit_grant (ADR-043)

## Intent
Vault token access must be auditable (S3 §3 "audited code path"; S6 §6 audit taxonomy): grant the vault role INSERT on audit_log (append-only) + its sequence. No table/data changes.

## Rollback
`REVOKE INSERT ON audit_log FROM aigos_vault; REVOKE USAGE ON SEQUENCE audit_log_id_seq FROM aigos_vault;`

## Backfill
None — grants only.
