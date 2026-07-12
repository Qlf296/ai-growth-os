# Global Repository Audit (through Phase 5) — AI Growth OS

**Date:** 2026-07-12 · **Referential:** v2.1 (frozen) · **Head:** Phase 5 (`5d722bc`). Full audit before Phase 6.

## Verification results

| Area | Method | Result |
|---|---|---|
| Typecheck | `tsc -b` (all packages/apps) | PASS |
| Full test suite | `vitest run` | 253/253 PASS (40 files) |
| Architecture tests | dependency-cruiser | PASS — 281 modules, 0 violations |
| CI gates | migrations / unscoped / decision-config | PASS (all three) |
| AI Gateway exclusivity (I6/AT-6) | grep model SDK imports outside `packages/ai-gateway` | CLEAN — none |
| Delivery exclusivity (I7/AT-7) | grep send SDK imports outside `packages/delivery` | CLEAN — none |
| Package boundaries | AT-boundaries (packages ↛ apps, domain framework-free, no deep imports, no cycles) | PASS |
| Dependency graph | dependency-cruiser orphan scan | No orphan modules |
| Dead code / unused exports | `ts-prune` (src only) | No unused public exports outside index/test; one intentional stub (see debt) |
| Duplicate code | manual review of the consolidated OAuth path (Phase 2.4/2.10) | No duplicates remain |
| Migration consistency | 12 sequential migrations, each with NOTES (Rollback+Backfill) | PASS — gate green |
| RLS integrity | 17 tenant tables ENABLE+FORCE + policy each | PASS — all 17 covered; global tables (users/plans/magic_link_tokens/sessions) correctly unscoped |
| Vault isolation (I8) | app role has zero grant on `provider_tokens`; token lifecycle audited | PASS (tested) |
| Config registry usage (ADR-046) | decisional tunables (GSC lag/quota, growth weights, detector thresholds) read from registry/rules-as-data | PASS — defaults in code seed the registry; runtime reads via registry/rules |
| Evidence (I4) | findings/opportunities/recommendations/drafts carry evidence refs (NOT NULL where persisted) | PASS |
| Performance regressions | pure-arithmetic engines (detection/growth), idempotent writes, indexed reads; no read-time scoring | None observed |

## Issues found
1. **`@prisma/client` / `prisma` declared as production dependencies of `@aigos/database`** but never imported at runtime (repositories use raw `pg`; Prisma is schema/migrate tooling only). Minor dependency-hygiene nit — not a referential violation.
2. **`canaryHandler` (worker) is exported but unconsumed** — a Phase-0 synthetic-canary stub kept for the Phase-0 exit-gate concept. Harmless dead-ish export.

## Issues fixed
- None required for referential compliance — nothing violates the frozen referential. (The `@prisma/client` move to devDependencies was attempted but reverted: in this sandbox `npm install` re-resolved and downgraded `cron-parser` to a breaking major; reverting the lockfile restored the green state. The dependency reclassification is deferred to a controlled environment to avoid an unrelated lockfile regression.)

## Remaining technical debt (carried, non-blocking)
- `@prisma/client`/`prisma` should be devDependencies of `@aigos/database` (do in a clean environment with a pinned lockfile so `cron-parser` is not re-resolved).
- `canaryHandler` stub unused; remove or wire the full spine canary when fleet scheduling lands.
- Real `ModelProvider` behind the AI Gateway and real `HttpGscTransport`/`FetchGoogleTokenEndpoint` are exercised only against fixtures in CI (deployment wiring).
- Live-Supabase pooler AT-9 run and real-Redis BullMQ integration are CI-jobs pending a real environment.
- `signals` uses a DEFAULT partition (monthly partitioning + 13-month retention pending the rollup job); `signal_rollups` not yet created (no writer).
- In-memory budget guard (Postgres-backed budgets from plan limits pending); per-workspace config/rule overrides supported but no UI sets them.
- Growth/detection/draft outputs not yet surfaced in the web UI or delivered via Delivery/digest.

## Recommendation
The repository is consistent with the frozen referential v2.1: invariants I4/I5/I6/I7/I8/I9 hold and are tested; boundaries, migrations, RLS and gates are all green; there is no architecture drift and no duplicate/dead code of consequence. Proceed to Phase 6. Address the two hygiene items (prisma devDeps, canary stub) opportunistically in a controlled lockfile environment.

## Ready for Phase 6
Yes.
