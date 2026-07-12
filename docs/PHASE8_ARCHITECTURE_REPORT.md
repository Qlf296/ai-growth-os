# Phase 8 Architecture Report — AI Growth OS

**Date:** 2026-07-12 · **Referential:** v2.1 (frozen) · **Scope:** Analytics & Learning (outcome measurement, attribution grading, Learning Propagator, reporting) · **Status:** complete, all gates green, working tree clean. Describes the current implementation only.

## 1. Executive summary
Phase 8 closes the growth loop: it measures the outcome of completed opportunities/experiments against a snapshotted baseline, grades the attribution honestly (ADR-033), propagates grade-weighted learning into per-detector track records (bounded, one writer), and surfaces it all on an evidence-referenced Learnings page. A new `@aigos/analytics` package implements the closed loop over existing evidence and lifecycle infrastructure. Five steps (8.1–8.5), one green commit each, tests-first. Suite grew from 303 to **309 tests**; architecture tests (333 modules, 0 violations) and CI gates green throughout.

## 2. Outcome measurement (8.1)
`outcome_evaluations` (S3 §7) records one append-only, idempotent row per (subject, metric, window): baseline (snapshotted at subject creation), observed value, window, verdict (met/partial/not_met/**unmeasurable**), and a mandatory `evidence_id` (I4). `recordOutcome` reuses the single Evidence Generator; evidence carries measured, **unmonetized** data (Law 15/ADR-034). `unmeasurable` is a first-class honest verdict (ADR-025 measurement ≠ interpretation).

## 3. Attribution grading (8.2)
`gradeOutcome` (ADR-033): A = UTM-keyed page-scoped with no confounders; B+ = UTM with a co-contributor; B = scoped GSC correlation; C = scoped with confounders; F = broad or unmeasurable. `LEARNING_WEIGHT` follows the grade (A 1.0 → F 0.0). Grade is stored on the outcome and embedded in its evidence — labeled evidence, never bare claims.

## 4. Learning Propagator (8.3)
`propagateLearning` is the **single writer** (I5, "one auditable pen") of `detector_track_record`. It recomputes each detector's grade-weighted success from graded outcomes over its contributing opportunities, bounds the score to [0,1], **abstains below a min-samples floor** (ADR-013), excludes `unmeasurable`, derives detector health (ADR-042: healthy/degraded/retire_candidate/insufficient_data), and audits the run (`learning.propagated`). Track record is derived data (not a config key), so it is not gated by AT-14; bounded step size honours ADR-013.

## 5. Reporting & Learnings page (8.4)
`analyticsSummary` returns the honest track record ("of N measured: M met…"), grade distribution, recent outcomes (each with its `evidence_reference_id`) and detector track record. `/learnings` renders it; every number is evidence-referenced (I4); honest empty state before the first measurement.

## 6. End-to-end (8.5)
One worker test runs the whole learning loop: detection → growth → opportunity completed → outcome measured + graded → learning propagated → analytics summary reflects it, with the same evidence reference carried end-to-end (I4).

## 7. Database changes
Migration 0015: `outcome_evaluations` (append-only, evidence FK, idempotent). 0016: `outcome_evaluations.grade` (ADR-033). 0017: `detector_track_record` (score/health, propagator-only writer). All new tenant tables RLS ENABLE+FORCE and workspace-scoped.

## 8. New migrations
`20260712000015_outcomes`, `20260712000016_outcome_grade`, `20260712000017_track_record` — expand-only, each with NOTES; pass the ADR-043 gate.

## 9. Package changes
New `@aigos/analytics` (depends on `@aigos/{database,intelligence}` + `pg`). `apps/web` depends on it for the Learnings page. No new external production dependency.

## 10. ADR compliance
ADR-033 (grades), ADR-025 (measurement ≠ interpretation; unmeasurable honest), ADR-034/Law 15 (measured units, no euro-ROI theatre), ADR-035/I4 (evidence generator; every claim referenced), ADR-013 (bounded learned arbitration), ADR-042 (detector health), ADR-043 (expand-contract), ADR-047 (audited propagation).

## 11. Invariants verification (I1–I14)
I4 (every outcome/summary claim carries evidence; loud-fail on a missing reference remains enforced), I5 (single writer of track records; outcomes append-only), I9 (RLS on all new tables — leak-tested), determinism (verdict/grade/propagation are pure and reproducible). AT-boundaries/AT-6/AT-7 clean.

## 12. Full audit
Typecheck OK · 309/309 tests · architecture tests 333 modules 0 violations · CI gates (migrations/unscoped/decision-config) green · dead-code/ts-prune clean (src) · 17 migrations sequential with NOTES · new RLS tables verified · AT-6/AT-7 clean · audit trail present (`opportunity.transition`, `experiment.evaluated`, `learning.propagated`) · no architecture drift, no duplicate/dead code introduced. Working tree clean.

## 13. Technical debt
Attribution grade A/B+ requires UTM-keyed attribution (ADR-020), not yet implemented, so real grades top out at B for now (honestly). Baseline is passed explicitly to `recordOutcome`; automatic baseline snapshotting at opportunity creation and a scheduled `outcomes.evaluate` job (fire at completed_at + window) are follow-ups. Track record is computed but not yet wired into arbitration/priority scoring (bounded feed influence) — deliberately deferred to keep the change reviewable. ROI ledger (S11 §4) not yet built. Carried: real ModelProvider/transports fixtures-only; `@prisma/client` devDep reclassification.

## 14. Remaining work
Snapshot baselines at creation + schedule `outcomes.evaluate`; wire track record into priority/arbitration (bounded, shadow-eval-gated); UTM measurement independence (ADR-020) to unlock grade A; build the ROI ledger; KB promotion from grade-A consistent outcomes (S11 §3.1); deliver outcome report-backs via Delivery (I7, ADR-014).

## 15. Phase 9 entry points
The loop is measurable end-to-end. Phase 9 can feed graded outcomes into the Recommendation Engine's arbitration (bounded `origin_track_record`, ADR-013), promote KB entries from consistent grade-A results (ADR-012), and deliver honest report-backs ("of your 14 completed SEO actions, 9 met target — grade-B measured") through the daily digest.

---
*Generated at the end of Phase 8. Describes the implemented system only; no future features invented.*
