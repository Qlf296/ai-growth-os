-- Phase 8 STEP 8.2 — attribution grade on outcomes (ADR-033). Expand-only.
ALTER TABLE outcome_evaluations
  ADD COLUMN grade text CHECK (grade IN ('A','B+','B','C','F'));
