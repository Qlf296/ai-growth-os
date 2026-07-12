-- Phase 8 STEP 8.3 — per-detector learned track record + health (ADR-042/013). Expand-only. RLS.
-- One writer only (the Learning Propagator, I5): a single auditable pen.

CREATE TABLE detector_track_record (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  detector     text NOT NULL,
  score        numeric,                 -- grade-weighted success in [0,1]; NULL = insufficient data
  samples      int NOT NULL DEFAULT 0,
  health       text NOT NULL DEFAULT 'insufficient_data'
               CHECK (health IN ('healthy','degraded','retire_candidate','insufficient_data')),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, detector)
);

ALTER TABLE detector_track_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE detector_track_record FORCE  ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON detector_track_record
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON detector_track_record TO aigos_app;
