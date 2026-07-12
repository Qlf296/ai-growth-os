-- Phase 2.4 — the vault code path is AUDITED (S3 §3): the vault role may
-- append audit events (token access), and nothing else beyond its token duty.
GRANT INSERT ON audit_log TO aigos_vault;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO aigos_vault;
