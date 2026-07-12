# Phase 9 Architecture Report — AI Growth OS

**Date:** 2026-07-12 · **Referential:** v2.1 (frozen) · **Scope:** Closed-Loop Optimization & Knowledge Evolution · **Status:** complete, all gates green, working tree clean. Describes the current implementation only.

## 1. Executive summary
Phase 9 makes the intelligence loop actually close and improve: immutable baselines, a scheduled outcome evaluator, bounded shadow-eval-gated arbitration, ADR-012 knowledge promotion, honest report-backs, and UTM-independent attribution — capped by a single end-to-end scenario that runs GSC → detection → growth → acceptance → automation → completion → measurement → grade → learning → knowledge → improved recommendation, with evidence at every step. Eight steps (9.1–9.8), one green commit each (plus one cleanup), tests-first. Suite grew from 309 to **336 tests**; architecture tests (350 modules, 0 violations) and CI gates green throughout.

## 2. Packages
13 workspace packages; Phase 9 added no new package. New modules landed in `@aigos/database` (baselines), `@aigos/analytics` (outcomes scheduler consumer, knowledge, attribution), `@aigos/growth` (arbitration V2), and `apps/worker` (outcomes handler).

## 3. Modules (added this phase)
`database/repositories/baselines.ts`; `analytics/{knowledge.ts, attribution.ts}` (+ grade/outcomes/propagator from Phase 8); `growth/arbitration.ts`; `apps/worker/outcomes.ts`; `action/digest.ts` (report-backs).

## 4. Tests
27 new tests: baselines (5), outcomes scheduler (4), arbitration V2 + shadow-eval (6), knowledge promotion (4), report-backs (1), attribution (6), plus the complete closed-loop e2e (1). Total suite **336/336** across 68 files.

## 5. Migrations
3 new, expand-only, each with NOTES (Rollback/Backfill): `20260712000018_baselines`, `20260712000019_knowledge` (both new RLS tables), and Phase 8's `..0015/16/17`. Total 19 migrations, all sequential; ADR-043 gate green.

## 6. New tables
`opportunity_baselines` (write-once, deterministic hash), `kb_entries` (epistemic level, propagator-only writer). Both RLS ENABLE+FORCE, workspace-scoped. 27 tenant tables now carry the isolation policy.

## 7. New repositories
`snapshotBaseline`/`getBaseline`/`baselineHash` (database). Analytics functions `recordOutcome`, `gradeOutcome`, `propagateLearning`, `evaluatePromotion`/`promoteKnowledge`, `resolveAttribution`, `analyticsSummary`. Growth `arbitrateV2`/`shadowEvaluateArbitration`.

## 8. Implemented ADRs
ADR-012 (KB promotion — validated only with grade-A + stability + shadow approval; propagator-only writer), ADR-013 (bounded learning — arbitration factor clamped, min-samples abstention), ADR-014 (digest report-backs assembled for Delivery), ADR-020 (measurement independence — never solely UTM), ADR-025 (measurement ≠ interpretation; unmeasurable honest), ADR-033 (grades), ADR-035/I4 (evidence at every step), ADR-042 (detector health), ADR-045 (shadow evaluation gates arbitration + config overrides), ADR-048 & Law 5 (no auto-publish), Law 15 (no ROI/money in report-backs), Law 16 (human-configured automation only), ADR-043 (expand-contract).

## 9. Verified invariants (I1–I14)
I2 (base dominates — shadow-eval rejects any flip on a base gap > margin; arbitration bounded), I4 (baselines/outcomes/KB/report-backs all evidence-linked; loud-fail preserved), I5 (single writers: baselines write-once, propagator-only KB/track-record), I9 (RLS on all new tables — leak-tested), I1-flavoured determinism (baseline hash, arbitration, attribution, promotion rule all pure/reproducible). AT-boundaries / AT-6 / AT-7 clean.

## 10. Technical debt
Arbitration V2 is implemented and shadow-eval-verified but not yet wired into the persisted feed scoring (kept as a reviewable, gated step before activation). The outcomes scheduler takes an injected `observe` provider; wiring it to real GSC page-scoped signal reads is a follow-up. UTM ingestion (GA4/ForgCV referral) is modelled by `resolveAttribution` but the UTM source rows are not yet ingested (so real grades top out at B honestly). Knowledge promotion is invoked explicitly; a nightly propagation+promotion job is a follow-up. Carried: real ModelProvider/transports fixtures-only in CI; `@prisma/client` devDep reclassification; `signals` DEFAULT partition + retention job.

## 11. Architecture audit
No drift: 350 modules, 0 dependency-cruiser violations; boundaries, RLS, AT-6/AT-7, migrations and CI gates all green; ts-prune clean (src), no orphan modules, no duplicated logic (analytics/growth reuse the Evidence Generator, grade rule and lifecycle). Audit trail present (`opportunity.transition`, `experiment.evaluated`, `learning.propagated`, `kb.promotion`). Working tree clean after every step; `npm ci` restores a green build (cron-parser dist intact).

## 12. Production readiness
The loop is mechanically complete and honest end-to-end: measurable without any platform API (GSC floor), evidence-referenced everywhere (I4), bounded and shadow-gated learning (I2/ADR-013/045), human-owned decisions and no auto-publish (Law 5/16). Remaining before production: activate arbitration V2 behind a real shadow-eval run and per-workspace opt-in; wire the outcomes `observe` to live signals; schedule nightly propagation/promotion; ingest UTM referral to unlock grade A; the standing deployment items (live Supabase pooler AT-9, real Redis, real model provider).

## 13. Remaining work before Phase 10
Activate the gated arbitration V2 in the persisted priority score (shadow-eval artifact + rollback path); schedule outcomes.evaluate + nightly learning/promotion fleet-wide; UTM referral ingestion (GA4/ForgCV) for grade-A attribution; deliver report-backs through Delivery (I7, ADR-014); cross-workspace aggregation (ADR-012 policy, k≥25) as a later, carefully-gated addition.

---
*Generated at the end of Phase 9. Describes the implemented system only; no future features invented.*
