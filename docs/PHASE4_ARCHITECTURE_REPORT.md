# Phase 4 Architecture Report — AI Growth OS

**Date:** 2026-07-12 · **Referential:** v2.1 (frozen) · **Scope:** Growth Intelligence Engine (opportunities → priority → recommendations → lifecycle → daily feed) · **Status:** complete, all gates green, working tree clean. Describes the current implementation only.

## 1. Executive summary
Phase 4 turns evidence-backed detector findings into a ranked, recommended daily growth feed. A new `@aigos/growth` package delivers the Opportunity Engine (page-grouped, ADR-031), a deterministic Priority Engine with Config-Registry weights, a data-only Recommendation Builder, an audited recommendation lifecycle, and a deterministic paginated feed. Everything is deterministic, idempotent and replay-safe; no AI, no generated text, no invented business value (Law 15/ADR-034). Suite grew from 232 to **244 tests**; architecture tests and CI gates green throughout.

## 2. Opportunity Engine
`buildOpportunities` groups a day's findings by page — one page, one opportunity (ADR-031) — carrying the union of contributing detectors and evidence ids. The dominant finding (highest severity, then detector name) sets severity/confidence; impact/difficulty/effort come from a fixed per-detector profile; ROI is honest (`{monetized:false, unit:"clicks", basis:"measured"}` — never a fabricated revenue value). Each opportunity carries a lifecycle status and deterministic dedupe hash (page|day).

## 3. Priority Engine
`score` computes a weighted sum of normalized factors (severity, confidence, impact, effort) with weights loaded from the Config Registry (`growth.weight.*`, decision-affecting → overrides gated by AT-14). Severity is the base term and carries the largest default weight, so learning tilts but never flips ordering (I2 spirit). The full trace (weights, factors, terms) is persisted on the opportunity. `rankOpportunities` gives a stable, reproducible order: score desc, then entity asc, then id asc.

## 4. Recommendation Builder
`buildRecommendation` produces a fully structured recommendation from per-detector data templates — title, summary, business reason, technical reason, expected impact, evidence ids, affected entities, prerequisites, implementation steps and rollback guidance. Data only, no generated text; expected impact is stated in measured units and explicitly not monetized.

## 5. Lifecycle
`opportunities.status` moves through detected → validated → accepted/postponed → completed, with rejected/expired terminal branches; `transitionOpportunity` enforces the legal state machine and audits every change (`opportunity.transition`). A human owns the decision (Law 16) — accept/reject/complete are recorded, never auto-taken.

## 6. Daily Feed
`buildFeed` reads persisted opportunities + recommendations for a day, ranks them deterministically, groups by category and paginates (default page size 3, S5 §1). Only actionable states (detected/validated/postponed) appear. Ordering is a pure function of stored rows, so the feed replays exactly; incremental generation is per-day.

## 7. Database changes
New tables `opportunities` (grouped findings, lifecycle status, priority_score + score_trace, honest ROI, evidence_ids, unique per (workspace, dedupe_hash)) and `recommendations` (data-only, one per opportunity). Both RLS ENABLE+FORCE and workspace-scoped; opportunities updatable for lifecycle, recommendations append-only.

## 8. New migrations
`20260712000011_growth` (expand-only, NOTES with Rollback/Backfill) — passes the ADR-043 gate.

## 9. Package changes
New `@aigos/growth` (depends on `@aigos/{config-registry,database,infra,intelligence}` + `pg`). `@aigos/intelligence` gained `listFindingsForDay`. `apps/worker` gained `createGrowthHandler` and depends on `@aigos/growth`. No new external production dependency.

## 10. ADRs implemented
ADR-031 (one page = one action grouping), ADR-046 (weights as config), ADR-034/Law 15 (honest ROI — measured units, unmonetized), ADR-035/I4 (evidence carried through to opportunities and recommendations), Law 16 (human owns the decision — audited lifecycle), ADR-003 (scheduler/queue reuse), ADR-043 (expand-contract migration), ADR-047 (growth metrics).

## 11. Invariants verified
I4 (every opportunity/recommendation carries evidence ids from findings), I9 (RLS on opportunities/recommendations — leak-tested), I5 (single writer: the growth engine), I2-flavoured base dominance (severity weight dominates; verified by test), determinism/replay (re-run yields identical feed). AT-boundaries/AT-6/AT-7 unaffected (263 modules, 0 violations).

## 12. Test coverage
12 new tests: priority units (deterministic scoring, base dominance, tie-breaking, grouping, recommendation completeness), growth integration on real Postgres (build, idempotency, RLS, feed ordering/pagination/replay, lifecycle transitions + audit), and a full worker e2e (signals → detection → growth → feed, replay determinism, RLS). Every recommendation template is exercised. Total suite 244/244.

## 13. Performance review
Pure arithmetic, €0: grouping is linear in findings; scoring is O(opportunities); ranking is a single sort. Idempotent upserts avoid write amplification on replay. Feed is a single indexed read + in-memory rank/paginate. No LLM, no read-time recomputation of scores (persisted).

## 14. Technical debt
Impact/difficulty/effort come from fixed per-detector profiles, not yet a learned or workspace-calibrated model (baselines land later). Weights are global defaults; per-workspace overrides are supported by the config gate but no UI sets them. Feed is computed on read (no snapshot table) — fine at current scale; a snapshot may be warranted with volume. Recommendations are not yet surfaced in the web UI or delivered via Delivery.

## 15. Remaining TODOs
Surface the feed in Today (web) and the digest (Delivery, ADR-014); wire fleet-wide growth scheduling; add opportunity dedupe against open/recent Actions (S10 §3); calibrate impact/effort from outcomes; expose lifecycle actions (accept/reject/postpone) via the API.

## 16. Entry points for Phase 5
The daily feed (`buildFeed`) and lifecycle are ready to drive the Today surface and the morning digest: render ranked recommendations with their evidence (I4 tripwire guards the first render component), let the human accept/reject/postpone (Law 16), and — on accept — hand off to draft generation via the AI Gateway (tier 3/4) and outcome measurement (Analytics), closing the loop the referential describes.

---
*Generated at the end of Phase 4. Describes the implemented system only; no future features invented.*
