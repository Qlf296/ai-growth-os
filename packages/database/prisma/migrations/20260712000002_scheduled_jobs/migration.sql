-- Phase 0 step 5 — scheduler-as-data (ADR-003, S3 §10). Expand-only.

CREATE TABLE scheduled_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id),  -- NULL = system job
  job_family   text NOT NULL,
  schedule     text NOT NULL,                   -- cron expr (schedules are data, not code)
  params       jsonb NOT NULL DEFAULT '{}',
  enabled      boolean NOT NULL DEFAULT true,
  last_run_at  timestamptz,
  next_run_at  timestamptz,
  last_status  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scheduled_jobs_enabled_idx ON scheduled_jobs (enabled) WHERE enabled;

ALTER TABLE scheduled_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_jobs FORCE  ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON scheduled_jobs
  USING (workspace_id IS NULL
         OR workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id IS NULL
              OR workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON scheduled_jobs TO aigos_app;
