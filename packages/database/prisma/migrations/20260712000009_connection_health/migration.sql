-- Phase 2.8 — connection health monitoring lifecycle (ADR-021 health model). Expand-only.
-- Separate from the frozen connections.status vocabulary (S3 §3): status is the raw
-- credential lifecycle; health_status is the monitored operational view shown to users.

ALTER TABLE connections
  ADD COLUMN health_status text NOT NULL DEFAULT 'pending'
  CHECK (health_status IN ('pending','healthy','degraded','reconnect_required','failed'));
