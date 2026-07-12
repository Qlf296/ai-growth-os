-- Phase 3 — signal intelligence: rules-as-data, detector findings, evidence, run history.
-- Expand-only. All tenant tables RLS ENABLE+FORCE; findings/evidence append-only by grant.

-- Evidence (ADR-035 single Evidence Generator; I4 — every claim references evidence).
CREATE TABLE evidence (
  id           uuid PRIMARY KEY,          -- deterministic content id (reproducible)
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  generated_by text NOT NULL,             -- detector name@version
  data         jsonb NOT NULL,            -- metrics, samples, window — the "why"
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_ws_idx ON evidence (workspace_id);

-- Rules as data (S3 §5): detector configuration. NULL workspace = global default; a
-- workspace row overrides it. Versioned, prioritized, enable/disable, thresholds as data.
CREATE TABLE detector_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id),
  detector     text NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,
  priority     int NOT NULL DEFAULT 100,
  version      int NOT NULL DEFAULT 1,
  thresholds   jsonb NOT NULL DEFAULT '{}',
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, detector)
);

-- Detector findings (candidates). Idempotent per (workspace, dedupe_hash).
CREATE TABLE detector_findings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id),
  detector         text NOT NULL,
  detector_version int NOT NULL,
  category         text NOT NULL,               -- 'seo'
  severity         text NOT NULL CHECK (severity IN ('info','low','medium','high')),
  priority         int NOT NULL,
  entity           text NOT NULL,               -- affected page URL
  confidence       text NOT NULL CHECK (confidence IN ('low','medium','high')),
  data             jsonb NOT NULL,
  evidence_id      uuid NOT NULL REFERENCES evidence(id),  -- I4: no finding without evidence
  occurred_at      timestamptz NOT NULL,
  dedupe_hash      text NOT NULL,
  run_id           uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, dedupe_hash)
);
CREATE INDEX detector_findings_ws_idx ON detector_findings (workspace_id, detector, occurred_at DESC);

-- Detector run history (execution traces, incremental watermark, replay audit).
CREATE TABLE detector_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id),
  detector       text NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  status         text NOT NULL,                 -- 'ok' | 'error'
  window_from    date,
  window_to      date,
  findings_count int NOT NULL DEFAULT 0,
  trace          jsonb NOT NULL DEFAULT '{}',
  error          text
);
CREATE INDEX detector_runs_ws_idx ON detector_runs (workspace_id, detector, started_at DESC);

ALTER TABLE evidence          ENABLE ROW LEVEL SECURITY;
ALTER TABLE detector_rules    ENABLE ROW LEVEL SECURITY;
ALTER TABLE detector_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE detector_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence          FORCE  ROW LEVEL SECURITY;
ALTER TABLE detector_rules    FORCE  ROW LEVEL SECURITY;
ALTER TABLE detector_findings FORCE  ROW LEVEL SECURITY;
ALTER TABLE detector_runs     FORCE  ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON evidence
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY ws_isolation ON detector_findings
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY ws_isolation ON detector_runs
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
-- Global rules (workspace_id IS NULL) readable in any scope; workspace rows scoped.
CREATE POLICY ws_isolation ON detector_rules
  USING (workspace_id IS NULL OR workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id IS NULL OR workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

GRANT SELECT, INSERT                 ON evidence          TO aigos_app;  -- append-only
GRANT SELECT, INSERT                 ON detector_findings TO aigos_app;  -- append-only
GRANT SELECT, INSERT, UPDATE         ON detector_runs     TO aigos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON detector_rules    TO aigos_app;

-- Global default rules (rules-as-data seed). Thresholds editable without deploys (D6).
INSERT INTO detector_rules (workspace_id, detector, priority, version, thresholds) VALUES
  (NULL, 'seo.striking_distance', 10, 1, '{"position_min":5,"position_max":20,"impressions_floor":100}'),
  (NULL, 'seo.ctr_gap',           20, 1, '{"impressions_floor":100,"min_gap":0.3}'),
  (NULL, 'seo.impression_drop',   30, 1, '{"min_prior_impressions":200,"drop_pct":0.3}'),
  (NULL, 'seo.click_drop',        40, 1, '{"min_prior_clicks":20,"drop_pct":0.3}');
