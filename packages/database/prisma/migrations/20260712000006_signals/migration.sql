-- Phase 2.2 — signals (S3 §4). Expand-only. Partitioned by occurred_at;
-- monthly partition automation + retention land with the rollup/retention job.

CREATE TABLE signals (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces(id),
  connection_id      uuid REFERENCES connections(id),
  source             text NOT NULL,             -- 'gsc' | 'ga4' | ...
  type               text NOT NULL,             -- e.g. 'gsc.search_analytics.daily'
  external_id        text,
  occurred_at        timestamptz NOT NULL,
  ingested_at        timestamptz NOT NULL DEFAULT now(),
  payload_ref        text NOT NULL,             -- raw store key (immutable, raw-first)
  data               jsonb NOT NULL,
  normalizer_version int NOT NULL,
  dedupe_hash        text NOT NULL,             -- provider+type+external_id → idempotent ingestion
  ladder_state       jsonb,
  PRIMARY KEY (workspace_id, occurred_at, id)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE signals_default PARTITION OF signals DEFAULT;

CREATE UNIQUE INDEX signals_dedupe_uq ON signals (workspace_id, dedupe_hash, occurred_at);
CREATE INDEX signals_type_idx ON signals (workspace_id, type, occurred_at DESC);

ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals FORCE  ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON signals
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- Signals are immutable facts: INSERT+SELECT only. Retention = DROP PARTITION (admin), never app DELETE.
GRANT SELECT, INSERT ON signals TO aigos_app;
