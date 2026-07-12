# ARCHITECTURE_TESTS.md — AI Growth OS

**Status:** v2.1. **Purpose:** the referential enforced by the build, not just the reader. These run in CI; a red architecture test blocks merge exactly like a failing unit test. Each maps to a SYSTEM_INVARIANT (I#) or a structural ADR. This file is the single most important defense against multi-developer drift.

## Category A — Boundary & dependency tests (static, fast)
- **AT-boundaries** — module import graph obeys declared boundaries; no module imports a forbidden peer; `packages/domain` imports no framework. (P2, S2 §2)
- **AT-6 Single LLM path (I6)** — the model provider SDK is importable only within the AI Gateway package; any other import fails the build. Catches the R9 bypass risk structurally.
- **AT-7 Single send path (I7)** — email/push SDKs importable only within Delivery.
- **AT-5 One writer (I5)** — write methods on KB/ledgers are package-private to their owning module; a KB `insert` outside the Learning Propagator fails compile.
- **AT-unscoped** — `dangerouslyUnscoped` DB API usages are enumerated and lint-gated; new ones require an allowlist entry + review.

## Category B — Data-safety tests
- **AT-8 Token sacredness (I8)** — (1) no code path outside the vault decrypts `provider_tokens`; (2) log-scrubber test feeds tokens/emails/magic-links through the logger and asserts they never appear in output; (3) frontend bundle asserted free of token fields.
- **AT-9 Tenant isolation (I9)** — the standing leak suite: for every repository, attempt cross-workspace read/write; any success is a red build. Runs on every migration too (ADR-043).
- **AT-4 / I4 Evidence-guarded claims** — numeric/comparative UI components fail to typecheck without an evidence-reference prop; a snapshot test scans rendered reports for unreferenced numerals.

## Category C — Decision-integrity tests
- **AT-1 Feed determinism (I1)** — replay a recorded day (tiers 0–2 + arbitration, model outputs as fixtures); assert byte-identical feed. Foundation of ADR-045.
- **AT-2 Ordering invariant (I2)** — property-based: for random candidate pairs, no legal multiplier vector inverts orderings beyond the margin.
- **AT-3 Confidence source (I3)** — mutate track record in a fixture; assert displayed confidence label unchanged.
- **AT-10 Side-effect gate (I10)** — assert no external-effect call path lacks a human-confirmation precondition; A2 execution asserts content-hash equality with the approved artifact.
- **AT-11 / AT-12 / AT-13 / AT-14** — interpretation-carries-evidence schema test; freshness gate; report replay; the CI config-change gate that refuses to activate a decision-affecting config key without a linked shadow-eval run.

## Category D — Governance gates (CI pipeline, not code)
- Config changes to keys tagged `decision-affecting` require a linked shadow-eval artifact (AT-14) — enforced in the merge pipeline.
- Schema migrations require rollback + backfill declarations (ADR-043) — a migration PR without them fails the check.
- Capability registry conformance: a `forbidden`/`unavailable` capability with a live code path fails CI (ADR-041).

**Coverage principle:** every SYSTEM_INVARIANT has ≥1 test here; every structural ADR (001–005, 019, 035, 041, 044–048) has a guarding test. Business logic is tested elsewhere (golden-file pipeline tests, S4); *these* protect the shape.
