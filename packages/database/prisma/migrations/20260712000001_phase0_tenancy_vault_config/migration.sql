-- Phase 0 step 3 — tenancy substrate, token vault, config store (S3 §§2,3,11; ADR-019/043/046; I5/I8/I9)
-- RLS keying: current_setting('app.workspace_id', true), set per TRANSACTION via SET LOCAL (pooler-safe).

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Runtime roles ────────────────────────────────────────────────────────────
-- aigos_app   : RLS-constrained application role (I9). NO access to provider_tokens (I8).
-- aigos_vault : the ONLY role that can touch provider_tokens; still RLS-scoped.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aigos_app') THEN
    CREATE ROLE aigos_app LOGIN PASSWORD 'app_pw_test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aigos_vault') THEN
    CREATE ROLE aigos_vault LOGIN PASSWORD 'vault_pw_test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- ── Global (non-tenant) tables ───────────────────────────────────────────────
CREATE TABLE plans (
  id     text PRIMARY KEY,          -- 'free' | 'creator' | 'growth' | 'agency'
  limits jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  auth_provider text NOT NULL,      -- 'magic_link' (ADR-016)
  locale        text NOT NULL DEFAULT 'fr',
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz         -- soft delete → GDPR purge job (S3 §2)
);

-- ── Tenant root ──────────────────────────────────────────────────────────────
CREATE TABLE workspaces (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  region     text NOT NULL DEFAULT 'eu',
  plan_id    text NOT NULL REFERENCES plans(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  role         text NOT NULL CHECK (role IN ('owner','admin','member')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

-- ── Connections & token vault (S3 §3, ADR-019) ───────────────────────────────
CREATE TABLE connections (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces(id),
  provider             text NOT NULL,             -- 'gsc' | 'ga4' | 'linkedin' | ...
  status               text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','expired','revoked','error')),
  scopes               text[] NOT NULL DEFAULT '{}',
  external_account_ref text,
  capabilities         jsonb NOT NULL DEFAULT '{}',  -- provider reality as data (R1)
  authorized_by        uuid NOT NULL REFERENCES users(id),  -- ADR-019: who granted it
  health_checked_at    timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX connections_workspace_idx ON connections (workspace_id);

CREATE TABLE provider_tokens (
  connection_id     uuid PRIMARY KEY REFERENCES connections(id),
  enc_access_token  bytea NOT NULL,     -- envelope-encrypted; key custody outside DB (I8)
  enc_refresh_token bytea,
  key_id            text NOT NULL,
  expires_at        timestamptz,
  rotated_at        timestamptz
);

-- ── Config overrides (ADR-046 — Postgres ConfigStore; append-only ledger) ────
CREATE TABLE config_overrides (
  id              bigserial PRIMARY KEY,
  key             text NOT NULL,
  value           jsonb NOT NULL,
  workspace_id    uuid REFERENCES workspaces(id),  -- NULL = global override
  changed_by      text NOT NULL,
  reason          text NOT NULL,
  shadow_eval_ref text,                            -- required for decision-affecting keys (ADR-045)
  changed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX config_overrides_key_idx ON config_overrides (key, workspace_id, id DESC);

-- ── Audit (append-only) ──────────────────────────────────────────────────────
CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id),     -- NULL = system-level event
  actor        text NOT NULL,
  event        text NOT NULL,
  details      jsonb NOT NULL DEFAULT '{}',
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_workspace_idx ON audit_log (workspace_id, id DESC);

-- ── RLS (I9 — layer 2 of S3 §11 defense in depth) ────────────────────────────
ALTER TABLE workspaces       ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships      ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_tokens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces       FORCE  ROW LEVEL SECURITY;
ALTER TABLE memberships      FORCE  ROW LEVEL SECURITY;
ALTER TABLE connections      FORCE  ROW LEVEL SECURITY;
ALTER TABLE provider_tokens  FORCE  ROW LEVEL SECURITY;
ALTER TABLE config_overrides FORCE  ROW LEVEL SECURITY;
ALTER TABLE audit_log        FORCE  ROW LEVEL SECURITY;

-- NULL/'' setting ⇒ predicate is NULL ⇒ no rows. No context, no data.
CREATE POLICY ws_isolation ON workspaces
  USING (id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

CREATE POLICY ws_isolation ON memberships
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

CREATE POLICY ws_isolation ON connections
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

CREATE POLICY ws_isolation ON provider_tokens
  USING (EXISTS (
    SELECT 1 FROM connections c
    WHERE c.id = connection_id
      AND c.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid))
  WITH CHECK (EXISTS (
    SELECT 1 FROM connections c
    WHERE c.id = connection_id
      AND c.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid));

-- Global rows (workspace_id IS NULL) are readable in any context; writes must be scoped or global.
CREATE POLICY ws_isolation ON config_overrides
  USING (workspace_id IS NULL
         OR workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id IS NULL
              OR workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

CREATE POLICY ws_isolation ON audit_log
  USING (workspace_id IS NULL
         OR workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id IS NULL
              OR workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── Grants (least privilege; I5/I8) ──────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO aigos_app, aigos_vault;

-- app role: tenant tables, NEVER provider_tokens (I8)
GRANT SELECT                          ON plans        TO aigos_app;
GRANT SELECT, INSERT, UPDATE          ON users        TO aigos_app;   -- soft delete = UPDATE deleted_at
GRANT SELECT, INSERT, UPDATE          ON workspaces   TO aigos_app;
GRANT SELECT, INSERT, UPDATE, DELETE  ON memberships  TO aigos_app;
GRANT SELECT, INSERT, UPDATE, DELETE  ON connections  TO aigos_app;
GRANT SELECT, INSERT                  ON config_overrides TO aigos_app;  -- append-only BY GRANT
GRANT SELECT, INSERT                  ON audit_log        TO aigos_app;  -- append-only BY GRANT
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO aigos_app;

-- vault role: provider_tokens plus read-only view of connections (for the join); nothing else
GRANT SELECT                          ON connections      TO aigos_vault;
GRANT SELECT, INSERT, UPDATE          ON provider_tokens  TO aigos_vault;  -- no DELETE: revoke-first runbook (R4)
