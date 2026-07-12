-- Phase 4 — Growth Intelligence: opportunities (grouped findings, ADR-031),
-- recommendations (data-only), lifecycle. Expand-only. RLS on all.

CREATE TABLE opportunities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id),
  entity         text NOT NULL,               -- affected page (one page = one opportunity, ADR-031)
  category       text NOT NULL,
  detectors      jsonb NOT NULL,              -- contributing detector names
  severity       text NOT NULL CHECK (severity IN ('info','low','medium','high')),
  confidence     text NOT NULL CHECK (confidence IN ('low','medium','high')),
  impact         text NOT NULL,              -- 'low'|'medium'|'high' (tiered, never invented value — Law 15)
  difficulty     text NOT NULL,
  effort         text NOT NULL,
  roi            jsonb NOT NULL,             -- honest: measured units, unmonetized until revenue attribution (ADR-034)
  priority_score numeric NOT NULL,
  score_trace    jsonb NOT NULL,            -- full deterministic scoring trace
  evidence_ids   jsonb NOT NULL,            -- I4: references to evidence rows
  status         text NOT NULL DEFAULT 'detected'
                 CHECK (status IN ('detected','validated','accepted','rejected','postponed','completed','expired')),
  occurred_on    date NOT NULL,
  dedupe_hash    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, dedupe_hash)
);
CREATE INDEX opportunities_rank_idx ON opportunities (workspace_id, occurred_on DESC, priority_score DESC, entity);

CREATE TABLE recommendations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id),
  opportunity_id    uuid NOT NULL REFERENCES opportunities(id),
  title             text NOT NULL,
  summary           text NOT NULL,
  business_reason   text NOT NULL,
  technical_reason  text NOT NULL,
  expected_impact   text NOT NULL,
  evidence_ids      jsonb NOT NULL,          -- I4
  affected_entities jsonb NOT NULL,
  prerequisites     jsonb NOT NULL,
  steps             jsonb NOT NULL,
  rollback          text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, opportunity_id)
);

ALTER TABLE opportunities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities   FORCE  ROW LEVEL SECURITY;
ALTER TABLE recommendations FORCE  ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON opportunities
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY ws_isolation ON recommendations
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON opportunities   TO aigos_app;
GRANT SELECT, INSERT         ON recommendations TO aigos_app;
