-- Phase 0 step 8 — passwordless auth + server-side sessions (ADR-016/017, S6 §§1-2). Expand-only.
-- Identity tables are global (pre-workspace): no workspace_id, no RLS; least-privilege grants.

CREATE TABLE magic_link_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        citext NOT NULL,
  token_hash   bytea NOT NULL UNIQUE,        -- sha256; plaintext token never stored (I8 discipline)
  ua_family    text NOT NULL,                -- bound to requesting user-agent family (ADR-016)
  requested_ip inet,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,         -- 10-minute expiry (ADR-016)
  consumed_at  timestamptz                   -- single-use
);
CREATE INDEX magic_link_rate_idx ON magic_link_tokens (email, created_at);
CREATE INDEX magic_link_ip_rate_idx ON magic_link_tokens (requested_ip, created_at);

CREATE TABLE sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- opaque cookie value
  user_id            uuid NOT NULL REFERENCES users(id),
  refresh_family     uuid NOT NULL,           -- family-invalidated on reuse detection (ADR-017)
  refresh_hash       bytea NOT NULL UNIQUE,   -- sha256 of the rotating refresh token
  rotated_at         timestamptz,             -- NULL = current generation; set when superseded
  ua_family          text NOT NULL,
  ip_created         inet,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,    -- access expiry (15 min)
  refresh_expires_at timestamptz NOT NULL,    -- 30-day refresh horizon (S6 §7 founder proposal)
  revoked_at         timestamptz              -- instant revocation is a query (ADR-017)
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_family_idx ON sessions (refresh_family);

GRANT SELECT, INSERT, UPDATE ON magic_link_tokens TO aigos_app;
GRANT SELECT, INSERT, UPDATE ON sessions TO aigos_app;
