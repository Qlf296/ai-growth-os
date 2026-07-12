# PERFORMANCE_BUDGET.md — AI Growth OS

**Status:** v2.1. Companion to Section 19 SLOs. **Purpose:** an SLO is a ceiling; a budget is how you spend under it — so a developer who adds 120 ms knows immediately whose budget they consumed. Budgets are owned (ADR-047 owner per SLI) and monitored.

## Today feed load — SLO p95 < 800 ms
| Segment | Budget | Notes |
|---|---|---|
| DB reads (feed snapshot + traces) | 150 ms | precomputed; it's a read, not a computation (S16 commit) |
| Redis (session, config snapshot) | 50 ms | hot-path cache |
| Recommendation read (assemble view model) | 150 ms | no scoring at read time — scoring ran in the nightly/triggered job |
| Rendering (SSR + hydrate) | 150 ms | |
| Network/margin | 300 ms | headroom is deliberate, not slack to be spent casually |

## On-accept draft — SLO perceived < 15 s
Gateway queue wait 2 s · context assembly 1 s · model generation (streamed) 10 s · validation+render 2 s. Streaming means *perceived* < first-token latency; the 15 s is full completion.

## Feed assembly job — SLO < 30 s/ws
Gate reads 5 s · scoring (pure arithmetic, all candidates) 5 s · arrangement 2 s · trace assembly + commit 8 s · margin 10 s. Fleet must finish ≥2 h before earliest digest.

**Rule:** exceeding a segment budget is a `degraded` signal (ADR-047) even when the SLO still passes — because a consumed margin is a warning, not a success. Perf work may never buy latency by weakening a correctness invariant (I1–I4); that trade is forbidden (P4, S19).
