# Phase 3 Architecture Report — AI Growth OS

**Date:** 2026-07-12 · **Referential:** v2.1 (frozen) · **Scope:** Signals Intelligence Engine (tier-0 detection over normalized signals) · **Status:** complete, all gates green, working tree clean. Describes the current implementation only.

## 1. Executive summary
Phase 3 turns normalized Signals into evidence-backed SEO findings. A new `@aigos/intelligence` package delivers the signal registry, a rules-as-data detection engine, four production SEO tier-0 detectors, a single content-addressed Evidence Generator (I4), and scheduler/queue integration. Detection is deterministic and idempotent (replay-safe). Suite grew from 216 to **232 tests**; architecture tests and CI gates green throughout. No AI, no recommendations, no provider calls — detectors read only stored normalized signals.

## 2. Signal architecture
Signal taxonomy and detector catalog are data (`registry.ts`): signal types (currently `gsc.search_analytics.daily`), and per-detector metadata (category, default severity, consumed signal type). Findings carry severity, priority, category, source detector+version, confidence and a mandatory evidence reference. Workspace isolation is enforced by RLS on every intelligence table.

## 3. Detection engine
`runDetection` reads the workspace's signals for a window, aggregates per page (impression-weighted position, summed clicks/impressions), loads effective rules, runs enabled detectors in priority order, and persists evidence + findings + a per-detector run trace inside workspace-scoped transactions. Deterministic ordering and content-addressed evidence make re-runs idempotent → replay determinism. Errors are recorded on `detector_runs` and rethrown for queue retry.

## 4. Rule engine
Rules as data (`detector_rules`, S3 §5): NULL-workspace global defaults overridden by workspace rows, merged by `loadRules`. Each rule carries enabled, priority, version and a thresholds JSON. `setWorkspaceRule` upserts a workspace override. Thresholds are editable without deploys (D6); priorities set deterministic execution order; disabling a detector removes it from the run.

## 5. Detector catalog
Four deterministic SEO tier-0 detectors over `gsc.search_analytics.daily`: `seo.striking_distance` (pages ranking 5–20 with impression volume), `seo.ctr_gap` (CTR below an honest position→CTR expectation), `seo.impression_drop` and `seo.click_drop` (sharp recent-vs-prior declines). Each emits per-page findings with explanation, confidence and evidence. Provider-specific technical detectors (sitemap, robots, coverage, canonical, mobile, Core Web Vitals) are intentionally deferred — they require signal types not yet ingested; adding them is a detector + signal-type addition, no engine change.

## 6. Evidence engine
Single Evidence Generator (`makeEvidence`, ADR-035): evidence is content-addressed — its id is a stable hash of (generator, sorted data) — so identical inputs yield the same evidence row (reproducible, idempotent). Every finding column `evidence_id` is NOT NULL and FK-references `evidence` (I4: no finding without evidence). Evidence carries the metrics, expectations and window that answer "why do you believe that?" (ADR-025).

## 7. Scheduler integration
Reuses the existing scheduler + queue (ADR-003). `detection.run` is a workspace scheduled job; the worker `createDetectionHandler` runs the engine for the scheduled day. Incremental by window; idempotent by design; retries/backoff/DLQ come from the queue; `detector_runs` is the execution history and replay audit.

## 8. Database changes
New tables: `evidence`, `detector_rules`, `detector_findings`, `detector_runs`. All RLS ENABLE+FORCE; findings/evidence append-only by grant; global rules readable in any scope. `detector_findings` is unique per (workspace, dedupe_hash) for idempotency; `evidence.id` is the deterministic content id.

## 9. New migrations
`20260712000010_detection` (expand-only, NOTES with Rollback/Backfill; seeds global default detector rules) — passes the ADR-043 migration gate.

## 10. Package changes
New `@aigos/intelligence` (depends on `@aigos/{config-registry,database,infra}` + `pg`). `@aigos/database` gained `readSignalsByType`. `apps/worker` depends on `@aigos/intelligence`. No new external production dependency.

## 11. ADRs implemented
ADR-035 (single Evidence Generator + evidence_reference_id), ADR-025 (measurement ≠ interpretation — findings carry data + evidence, not verdicts), ADR-046 (thresholds as data, rules-as-data per S3 §5), ADR-003 (scheduler/queue reuse), ADR-043 (expand-contract migration), ADR-047 (detection metrics).

## 12. Invariants verified
I4 (no claim without evidence — enforced by NOT NULL FK + tested), I9 (tenant isolation on all intelligence tables — leak-tested), I5 (single writer: the engine is the only writer of findings/evidence/runs), I1-flavoured determinism (replay adds nothing). AT-boundaries/AT-6/AT-7 unaffected (236 modules, 0 violations).

## 13. Test coverage
16 new tests: pure detector unit tests (thresholds, determinism, evidence presence), engine integration on real Postgres (rules-as-data override, evidence FK/I4, idempotent replay, RLS, disabled detector), and a scheduler end-to-end (tick → queue → handler → evidence-backed findings + run history, replay determinism, RLS). Every detector has fixtures/seeded signals and is exercised end-to-end. Total suite 232/232.

## 14. Performance review
Detection is pure arithmetic over a bounded signal window (no LLM, €0). One signal read per run; per-page aggregation is linear. Idempotent inserts avoid write amplification on replay. Runs are per-workspace and per-detector, keeping work proportional to active data. No read-time scoring.

## 15. Technical debt
Detector catalog covers search-analytics signals only; technical SEO detectors await GSC coverage/sitemaps signal ingestion. The position→CTR expectation is a static honest curve (labeled), not yet the workspace's own curve (ADR-030) — that upgrade lands with baselines. `detection.run` is scheduled per workspace but fleet-wide scheduling wiring (enumerating workspaces) is not yet automated. Findings are candidates only — grouping-by-page (ADR-031) and Action creation are Phase 4.

## 16. Remaining TODOs
Ingest GSC index-coverage/sitemaps signals to unlock technical detectors; compute per-workspace position→CTR curve (ADR-030); page-grouping merge (ADR-031); wire fleet-wide detection scheduling; expose findings in the product surface.

## 17. Entry points for Phase 4
`detector_findings` (evidence-backed candidates, tenant-isolated) are the input to Growth Intelligence (S8) and the Recommendation Engine (S16): group by page (ADR-031), score/arbitrate, and emit Actions to Today. Evidence rows are ready to back every claim rendered in the UI (I4 tripwire already guards the first render component).

---
*Generated at the end of Phase 3. Describes the implemented system only; no future features invented.*
