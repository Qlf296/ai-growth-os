-- Phase 7 STEP 7.1 — automation rules (as data) + execution history. Expand-only. RLS.
-- Ladder bounded to A0/A1/A2 (ADR-048; A3/A4 forbidden) by CHECK.

CREATE TABLE automation_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name         text NOT NULL,
  trigger      jsonb NOT NULL,                 -- { type, filter? } as data
  condition    jsonb NOT NULL DEFAULT '[]',    -- AND of clauses as data
  action       text NOT NULL,                  -- registered action name
  ladder_level text NOT NULL CHECK (ladder_level IN ('A0','A1','A2')),
  enabled      boolean NOT NULL DEFAULT true,
  created_by   uuid NOT NULL REFERENCES users(id),  -- Law 16: a human configured it
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automation_rules_ws_idx ON automation_rules (workspace_id) WHERE enabled;

CREATE TABLE automation_executions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  rule_id      uuid NOT NULL REFERENCES automation_rules(id),
  trigger_ref  text NOT NULL,                  -- idempotency key (rule + subject)
  status       text NOT NULL,                  -- 'ok' | 'skipped' | 'error'
  result       jsonb NOT NULL DEFAULT '{}',
  executed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, rule_id, trigger_ref)
);

ALTER TABLE automation_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules      FORCE  ROW LEVEL SECURITY;
ALTER TABLE automation_executions FORCE  ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON automation_rules
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY ws_isolation ON automation_executions
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON automation_rules      TO aigos_app;
GRANT SELECT, INSERT                 ON automation_executions TO aigos_app;
