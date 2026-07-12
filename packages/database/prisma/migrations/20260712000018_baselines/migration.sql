-- Phase 9 STEP 9.1 — immutable opportunity baselines (S3 §7: baseline snapshotted at creation).
-- Expand-only. RLS. One row per opportunity+metric, write-once (INSERT only, no UPDATE grant).

CREATE TABLE opportunity_baselines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id),
  metric        text NOT NULL,
  baseline_value numeric,               -- NULL = unmeasurable baseline (honest, ADR-025)
  window_days   int NOT NULL,
  snapshot_hash text NOT NULL,          -- deterministic content hash (replay-safe)
  captured_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, opportunity_id, metric)   -- snapshot once
);
CREATE INDEX opportunity_baselines_idx ON opportunity_baselines (workspace_id, opportunity_id);

ALTER TABLE opportunity_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_baselines FORCE  ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON opportunity_baselines
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

GRANT SELECT, INSERT ON opportunity_baselines TO aigos_app;  -- write-once, immutable
