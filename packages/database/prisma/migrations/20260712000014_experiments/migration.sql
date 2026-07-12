-- Phase 7 STEP 7.2 — experiments (A/B), variants, deterministic assignments, metrics. Expand-only. RLS.

CREATE TABLE experiments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id),
  recommendation_id uuid REFERENCES recommendations(id),  -- source (nullable)
  hypothesis        text NOT NULL,
  expected_impact   text NOT NULL,
  confidence        text NOT NULL CHECK (confidence IN ('low','medium','high')),
  metric            text NOT NULL,                         -- the KPI being tested
  status            text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','archived')),
  winner_variant_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  decided_at        timestamptz
);
CREATE INDEX experiments_ws_idx ON experiments (workspace_id, status);

CREATE TABLE experiment_variants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  label         text NOT NULL,                             -- 'control' | 'treatment' | ...
  payload       jsonb NOT NULL DEFAULT '{}',
  UNIQUE (experiment_id, label)
);

CREATE TABLE experiment_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  unit          text NOT NULL,                             -- assignment unit (e.g. page url)
  variant_id    uuid NOT NULL REFERENCES experiment_variants(id),
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, unit)                             -- stable assignment
);

CREATE TABLE experiment_metrics (
  id            bigserial PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES experiments(id),
  variant_id    uuid NOT NULL REFERENCES experiment_variants(id),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  metric        text NOT NULL,
  value         numeric NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX experiment_metrics_idx ON experiment_metrics (experiment_id, variant_id);

ALTER TABLE experiments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_variants    ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_metrics     ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiments            FORCE  ROW LEVEL SECURITY;
ALTER TABLE experiment_variants    FORCE  ROW LEVEL SECURITY;
ALTER TABLE experiment_assignments FORCE  ROW LEVEL SECURITY;
ALTER TABLE experiment_metrics     FORCE  ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON experiments            USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY ws_isolation ON experiment_variants    USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY ws_isolation ON experiment_assignments USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY ws_isolation ON experiment_metrics     USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON experiments            TO aigos_app;
GRANT SELECT, INSERT         ON experiment_variants    TO aigos_app;
GRANT SELECT, INSERT         ON experiment_assignments TO aigos_app;
GRANT SELECT, INSERT         ON experiment_metrics     TO aigos_app;
GRANT USAGE ON SEQUENCE experiment_metrics_id_seq TO aigos_app;
