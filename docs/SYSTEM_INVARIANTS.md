# SYSTEM_INVARIANTS.md — AI Growth OS

**Status:** Frozen with referential v2.1. **Rank:** invariants sit *above* ADRs — an ADR may not contradict an invariant; a feature that breaks one does not ship.
**Rule:** every invariant below names its enforcing test (see ARCHITECTURE_TESTS.md). An invariant without a test is a wish; each here has one.

These are the properties that must hold for the system to be *itself*. Not features, not preferences — the load-bearing truths the whole referential rests on.

| # | Invariant | Enforced by |
|---|---|---|
| **I1** | **Feed determinism.** Same inputs + same config/rules/template versions → byte-identical feed. The only randomness is the seeded exploration slot. | AT-1 (replay equality test, ADR-045) |
| **I2** | **Base dominates learning.** No multiplier combination inverts the order of two actions whose base scores differ by more than `ordering_invariant_margin`. Learning tilts, never flips. | AT-2 (property-based ordering test, S16) |
| **I3** | **Confidence is evidence-only.** The displayed confidence label is never mutated by track record, recency, or any performance signal. | AT-3 (label-source test — confidence derives solely from evidence refs) |
| **I4** | **No claim without evidence.** No number, percentage, comparison, or performance statement renders anywhere without an `evidence_reference_id`. | AT-4 (render-guard: numeric/comparative components require the ref prop; ADR-035) |
| **I5** | **One writer per store.** Each of the eight memories (S15) and every ledger has exactly one writer path. KB is written only by the Learning Propagator. | AT-5 (writer-boundary test) |
| **I6** | **Single LLM path.** Only the AI Gateway calls a model. No pipeline, agent, or report assembles or sends a prompt directly. | AT-6 (call-graph test — model SDK importable only within Gateway) |
| **I7** | **Single send path.** Only Delivery emits user-facing notifications. Pipelines emit intents, never messages. | AT-7 (send-boundary test) |
| **I8** | **Tokens are sacred.** Provider tokens are decrypted only in the vault code path, never logged, never sent to the frontend, never readable by the app's default DB role or any worker directly. | AT-8 (token-access test + log-scrub test) |
| **I9** | **Tenant isolation.** No query returns cross-workspace rows. Every tenant-table access is workspace-scoped (repo + RLS). | AT-9 (cross-tenant leak suite, standing) |
| **I10** | **No side effect without a human.** Nothing publishes, sends, or modifies the user's external properties without explicit human confirmation of the exact artifact (ADR-048; A2 freezes at approval). | AT-10 (side-effect-gate test) |
| **I11** | **Interpretation never replaces measurement.** Every interpretive field (bottleneck, trend, verdict) carries data_quality + evidence + confidence, separable from the raw metric. | AT-11 (schema test: interpretation fields non-nullable in evidence) |
| **I12** | **Stale knowledge cannot be strong evidence.** Knowledge past `fresh_until` may display (dated) but cannot cite above Medium confidence, promote in KB, or boost arbitration. | AT-12 (freshness-gate test, ADR-039) |
| **I13** | **Reports are reproducible.** Any report regenerates from stored evidence/traces; the render is deterministic over ledgers and snapshots. | AT-13 (report-replay test) |
| **I14** | **Decision-affecting changes are shadow-evaluated.** No weight, threshold, mapping, or decision-rule change activates without passing shadow evaluation (ADR-045). | AT-14 (CI gate on config keys tagged decision-affecting) |

Change process for an invariant: it requires the full Decision Record Lifecycle (see DECISION_LIFECYCLE.md) *plus* explicit acknowledgment that an invariant is being altered — the heaviest change class in the project, by design.
