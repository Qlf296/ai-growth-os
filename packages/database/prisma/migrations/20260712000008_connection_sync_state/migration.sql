-- Phase 2.7 — per-connection synchronization state/metadata (ADR-021 health model). Expand-only.

CREATE TABLE connection_sync_state (
  connection_id        uuid PRIMARY KEY REFERENCES connections(id),
  workspace_id         uuid NOT NULL REFERENCES workspaces(id),
  last_successful_sync timestamptz,          -- watermark: incremental resume point
  last_attempted_sync  timestamptz,
  last_duration_ms     integer,
  imported_rows        bigint NOT NULL DEFAULT 0,  -- cumulative
  api_quota_used       bigint NOT NULL DEFAULT 0,  -- cumulative provider calls
  last_error           text,                 -- NULL when the last run succeeded
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX connection_sync_state_ws_idx ON connection_sync_state (workspace_id);

ALTER TABLE connection_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE connection_sync_state FORCE  ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON connection_sync_state
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON connection_sync_state TO aigos_app;
