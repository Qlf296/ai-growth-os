-- Phase 5 — AI Action Engine: drafts (with full generation metadata + approval
-- lifecycle) and the LLM usage ledger (S3 §9). Expand-only. RLS on all.

CREATE TABLE llm_calls (
  id            bigserial PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  feature       text NOT NULL,
  tier          text NOT NULL,
  provider      text NOT NULL,
  input_tokens  int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  cost_eur      numeric NOT NULL DEFAULT 0,
  latency_ms    int,
  cached        boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'ok',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llm_calls_ws_idx ON llm_calls (workspace_id, created_at DESC);

CREATE TABLE drafts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid NOT NULL REFERENCES workspaces(id),
  recommendation_id      uuid NOT NULL REFERENCES recommendations(id),
  draft_type             text NOT NULL,
  content                text NOT NULL,
  prompt_template_id     text NOT NULL,
  prompt_template_version int NOT NULL,   -- ADR-044
  provider               text NOT NULL,
  tier                   text NOT NULL,
  cached                 boolean NOT NULL,
  trace_id               uuid NOT NULL,
  input_tokens           int NOT NULL DEFAULT 0,
  output_tokens          int NOT NULL DEFAULT 0,
  cost_eur               numeric NOT NULL DEFAULT 0,
  latency_ms             int,
  evidence_ids           jsonb NOT NULL,   -- I4
  status                 text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','reviewed','approved','rejected','regenerated','published')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drafts_ws_idx ON drafts (workspace_id, recommendation_id, created_at DESC);

ALTER TABLE llm_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_calls FORCE  ROW LEVEL SECURITY;
ALTER TABLE drafts    FORCE  ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON llm_calls
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY ws_isolation ON drafts
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

GRANT SELECT, INSERT         ON llm_calls TO aigos_app;   -- append-only usage ledger
GRANT USAGE ON SEQUENCE llm_calls_id_seq TO aigos_app;
GRANT SELECT, INSERT, UPDATE ON drafts    TO aigos_app;
