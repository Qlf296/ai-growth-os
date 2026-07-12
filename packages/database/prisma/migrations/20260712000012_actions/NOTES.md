# Migration notes — 20260712000012_actions (ADR-043)

## Intent
Phase 5 AI Action Engine: llm_calls usage ledger (S3 §9, append-only, cost reporting) and drafts (generation metadata incl. prompt_template_version ADR-044, cost/tokens/latency/cached, evidence_ids I4, approval-lifecycle status). RLS + workspace-scoped.

## Rollback
Expand-only. DROP TABLE drafts, llm_calls; -- contract:

## Backfill
None — populated as drafts are generated.
