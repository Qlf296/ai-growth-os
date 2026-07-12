# BUILD_RULES.md — AI Growth OS

**Status:** Binding on all implementation (human or AI). Lives at `/docs/BUILD_RULES.md` in the repo. Read before writing code, every session.

## The One Rule
**Never implement anything that violates a frozen architecture document. When uncertain, stop and ask — do not work around it.**

Frozen documents (v2.1): the 20 section specs · PRODUCT_ETHICAL_RULES.md (Constitution) · SYSTEM_INVARIANTS.md · ARCHITECTURE_TESTS.md · ARCHITECTURE_REVIEW.md. Precedence when in tension: **Security > GDPR > Constitution > Invariants > ADRs > Features.**

## Non-negotiables (the invariants restated for the implementer)
- Only the AI Gateway may call a model. Only Delivery may send notifications. Only the Learning Propagator writes the KB. (I5/I6/I7 — enforced by AT-5/6/7.)
- Provider tokens: vault path only, never logged, never to frontend, never readable by default DB role or workers. (I8/AT-8.)
- Every tenant query is workspace-scoped; RLS is mandatory, not optional. (I9/AT-9.)
- No number/comparison renders without an evidence reference. (I4/AT-4.)
- No side effect (publish/send/modify user property) without explicit human confirmation of the exact artifact. (I10/ADR-048.)
- Every tunable goes in the config registry, not in code. Decision-affecting config changes require shadow evaluation. (ADR-046/045.)

## Order of construction (Phase 0 — foundations before features)
Build in this order; **architecture tests are written before the code they guard**, so the skeleton is self-defending from commit #1:
1. Monorepo + module boundaries + boundary test (AT-boundaries) — the boundary test passes on an empty skeleton.
2. `packages/config-registry` (ADR-046) — everything else stores tunables here.
3. `packages/database` — Prisma schema, **RLS via `SET LOCAL app.workspace_id` per transaction** (pooler-safe; see repo NOTE on Supabase), leak-test harness (AT-9) green.
4. Redis queue/cache wiring; S3 storage abstraction (raw-first).
5. `apps/api` + `apps/worker` skeletons; scheduler.
6. `packages/ai-gateway` shell — the ONLY package allowed to import a model SDK (AT-6 enforces); no real calls yet.
7. `packages/delivery` shell — the ONLY sender (AT-7).
8. Auth (ADR-016/017) — passwordless, our own layer, server sessions.
9. Observability skeleton (ADR-047) + error tracking; synthetic-canary stub.
10. CI/CD with all architecture tests wired as merge gates; migration checks (ADR-043).
11. **Prove the invariants bite:** deliberately write a violating commit for each of AT-4/5/6/7/8/9 and confirm CI rejects it. A guard never tested against a real violation is not a guard.

**Stop after Phase 0. Present:** folder structure, tech choices (with the Supabase/RLS decision recorded as an ADR), tests passing, violation-rejection proof (step 11), problems hit, recommended next step. Do not begin Phase 1 pipelines until Phase 0 is ratified.

## When Claude Code is uncertain
Stop. State which document/invariant is in tension, quote it, propose options, ask. A paused build is cheap; a referential violation discovered in week 3 is not. This rule exists because capable tools follow instructions faithfully — including instructions that drift. The frozen documents do not drift; when code and document disagree, the document wins or the document is formally changed (DECISION_LIFECYCLE.md) — never silently overridden.
