-- Phase 8 STEP 8.1 — outcome evaluations, the closed loop (S3 §7). Append-only. RLS.
-- Measurement ≠ interpretation (ADR-025): raw baseline/observed here; grades/verdicts derive from them.
-- Honest ROI (Law 15/ADR-034): measured units only, never fabricated monetary attribution.

CREATE TABLE outcome_evaluations (
  id             bigserial PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces(id),
  subject_type   text NOT NULL CHECK (subject_type IN ('opportunity','experiment')),
  subject_id     uuid NOT NULL,
  metric         text NOT NULL,
  baseline_value numeric,                 -- snapshotted at subject creation; NULL = unmeasurable baseline
  observed_value numeric,                 -- measured at evaluation; NULL = unmeasurable
  window_days    int NOT NULL,
  verdict        text NOT NULL CHECK (verdict IN ('met','partial','not_met','unmeasurable')),
  evidence_id    uuid NOT NULL REFERENCES evidence(id),   -- I4: no claim without evidence
  evaluated_at   timestamptz NOT NULL DEFAULT now(),
  dedupe_hash    text NOT NULL,
  UNIQUE (workspace_id, dedupe_hash)
);
CREATE INDEX outcome_evaluations_subject_idx ON outcome_evaluations (workspace_id, subject_type, subject_id, evaluated_at DESC);

ALTER TABLE outcome_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcome_evaluations FORCE  ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON outcome_evaluations
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

GRANT SELECT, INSERT ON outcome_evaluations TO aigos_app;  -- append-only
GRANT USAGE ON SEQUENCE outcome_evaluations_id_seq TO aigos_app;
