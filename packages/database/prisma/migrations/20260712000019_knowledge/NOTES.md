# Migration notes — 20260712000019_knowledge (ADR-043)

## Intent
Workspace Knowledge Base (ADR-012): entries with an epistemic level (hypothesis/observation/validated). Promotion to 'validated' requires hard criteria (enough samples, enough Grade-A outcomes, stability, shadow-eval approval); grade-A evidence only for validated. Written by the Learning Propagator only (I5). Evidence ids attached (I4). RLS.

## Rollback
Expand-only. DROP TABLE kb_entries; -- contract:

## Backfill
None — created/promoted by the propagator from graded outcomes.
