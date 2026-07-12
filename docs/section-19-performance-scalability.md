# AI Growth OS — Section 19: Performance & Scalability

**Status:** Proposed v1 — pending founder review
**Nature:** consolidation. The scaling architecture was decided in ADR-001–005 and refined since; this section gathers every declared trigger into one table, adds the performance *guarantees* (SLOs) the product commits to, and prices the growth curve. **No new ADRs, no new mechanisms.**

---

## 1. Performance Guarantees (user-facing SLOs — ADR-047 SLIs get targets)

| Surface | SLO (p95) | Why this number |
|---|---|---|
| Today feed load | < 800 ms | server-rendered snapshot read (S16 commit) — it's a read of a precomputed decision, which is the architecture's whole point |
| Action detail / evidence drawer | < 500 ms | trace + evidence refs are materialized (ADR-044), not computed on view |
| Digest generation (per ws) | < 5 s job | deterministic assembly |
| Feed assembly job | < 30 s/ws, daily fleet completes ≥ 2h before earliest digest window | the schedule's real constraint |
| Ingestion lag (signal → available) | < 15 min from provider availability | honest: GSC's own ~2-day lag dominates; we never pretend otherwise |
| On-accept draft (tier-4) | < 15 s perceived | streaming render in composer |
| Urgent interrupt (acute rule → send decision) | < 5 min | hourly acute sweep + rule eval |

**Every SLO has a measurable owner and an automated monitor** (founder principle, no ADR needed): SLO → SLI (ADR-047) → alert → named owner; no performance objective exists as documentation only. And one explicit subordination, restating P4: **performance optimizations may never change recommendation correctness** — a faster feed that ranks differently is a defect, and ADR-045 replay is the test that catches it (same inputs, same config → same feed, at any speed).
SLO breaches are `degraded` states (ADR-047) with the honest-surfacing rules already law. No SLO exists for "analytics queries" — there is no analytics destination to be slow (the No-Analytics-tab decision is also a performance strategy, it turns out).

## 2. The Load Model (what actually scales with workspaces)

Per active workspace/day, order of magnitude: ~50–500 ingested signals (plan-dependent polling) · ~10³ tier-0 rule evaluations (microseconds each) · ~10–50 tier-1 scorings · ~0–10 tier-2/3 escalations · ~0–3 tier-4 calls (on-accept) · 1 feed assembly · ~5–20 background jobs. **Everything user-facing reads precomputed state.** The heavy work is embarrassingly parallel by workspace — which is why the scaling story below is boring, and boring is the goal.

## 3. Trigger Table (consolidated from ADR-002/003/005 + Section 2 §15 — the single source now)

| # | Measured trigger | Response | Prepared by |
|---|---|---|---|
| 1 | web/worker CPU sustained >70% or queue lag >5 min at peak | horizontal replicas (stateless by design) | ADR-005; per-provider token buckets already fleet-safe |
| 2 | p95 OLTP reads degrade under analytical load | read replica; rollup/report queries move to it | ADR-002 |
| 3 | signal analytics still harming OLTP | ClickHouse-class store for signals; Postgres keeps OLTP | raw-first S3 + versioned normalizers make backfill a job, not a crisis |
| 4 | queue replay / multi-consumer need, or >~1k jobs/s sustained | event streaming for ingestion bus only | module boundaries + queue-based comms (S2 §2) |
| 5 | pgvector beyond comfort (~10⁷+ embeddings) | dedicated vector store | embedding model/version registry (S3 §8) makes re-index a job |
| 6 | one module's load/team diverges | extract along existing boundary | import-linted boundaries, domain events |
| 7 | signals partitions unwieldy | already monthly-partitioned; retention DROP is the relief valve | ADR-002 retention + R28-style rollup verification |
| 8 | data-residency contracts | multi-region tenancy (workspace.region exists since day 1) | S3 §2 schema; **explicitly not implemented before the trigger** |
| 9 | KMS/vault throughput at scale | DEK caching with short TTL in vault path | S18 §4 envelope design permits it |

The discipline restated once: **no row activates without its measurement.** ADR-047 dashboards watch exactly these numbers; the trigger table is their alert config.

## 4. Cache Strategy (the complete list — deliberately short)

Redis: gateway response cache (declared invalidation, R8-closed) · baseline/rollup hot reads (TTL = recompute cadence) · session lookups · per-provider token buckets · config registry snapshot (invalidated on version bump — reads are hot-path). **Not cached:** anything feeding a verdict or trace (correctness beats latency in the learning loop — stale evidence is worse than slow evidence), and tokens (never).

## 5. Cost Curve (the budget commitment, consolidating every D5 annotation)

| Scale (active ws) | Infra | LLM (ladder-enforced) | External APIs (plan-mix dependent) | COGS/paid ws |
|---|---|---|---|---|
| 1k | ~€300–500 | €0.15–0.35/ws | €0–2/ws (SERP on paid tiers) | **≈ €1–3** ✓ under the €3 ceiling (S2 §14) |
| 10k | ~€1.5–3k (replicas, replica DB) | unchanged per-ws (that's the point of the ladder) | linear, plan-capped | ≈ €1–3 (flat by design) |
| 100k | trigger rows 3–5 live; infra ~€15–30k | unchanged per-ws | linear | ≈ €1.5–3.5 |

The architectural claim, stated for the record: **per-workspace COGS is flat by design** — every per-user cost (LLM, polling, SERP) is plan-capped config, and every infra cost amortizes. If a future feature bends this curve, its D5 annotation shows it before code exists. That is the promise Sections 2's cost thesis made; this table is where it becomes accountable.

## 6. Delta

No new ADRs, no new risks. One consolidation note for v2.0: Section 2 §15's roadmap table is superseded by §3 above (single source — the old table gets a pointer). **Open questions — resolved by founder:** SLOs ratified as launch targets ✓ · multi-region strictly contract-driven, no speculative builds ✓.
