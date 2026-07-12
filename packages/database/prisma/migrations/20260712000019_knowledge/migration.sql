-- Phase 9 STEP 9.4 — workspace Knowledge Base (ADR-012). Expand-only. RLS.
-- Written by the Learning Propagator only (ADR-035, I5). Epistemic level gates promotion.

CREATE TABLE kb_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id),
  key             text NOT NULL,                 -- e.g. 'detector:seo.ctr_gap'
  epistemic_level text NOT NULL DEFAULT 'hypothesis'
                  CHECK (epistemic_level IN ('hypothesis','observation','validated')),
  samples         int NOT NULL DEFAULT 0,
  grade_a_count   int NOT NULL DEFAULT 0,
  evidence_ids    jsonb NOT NULL DEFAULT '[]',    -- I4
  freshness_source text NOT NULL DEFAULT 'verified_by_outcome',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);

ALTER TABLE kb_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_entries FORCE  ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON kb_entries
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON kb_entries TO aigos_app;
