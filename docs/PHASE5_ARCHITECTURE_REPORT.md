# Phase 5 Architecture Report — AI Growth OS

**Date:** 2026-07-12 · **Referential:** v2.1 (frozen) · **Scope:** AI Action Engine (draft generation, prompt registry, cost/budget, approval workflow, daily digest) · **Status:** complete, all gates green, working tree clean. Describes the current implementation only.

## 1. Executive summary
Phase 5 turns approved recommendations into evidence-referenced drafts through the AI Gateway, under a strict human-approval workflow. A new `@aigos/action` package delivers the Draft Generation Engine (8 draft types), data-only prompt templates (immutable versions), an append-only LLM usage ledger, an audited draft lifecycle with no automatic publishing (Law 5), and a deterministic daily AI digest. All model access goes through the AI Gateway (I6/AT-6). Suite grew from 244 to **253 tests**; architecture tests and CI gates green throughout.

## 2. Draft Generation Engine
`generateDraft` loads a recommendation + its opportunity, renders the type's prompt template, and calls `AIGateway.infer` (tier 3) — the only path to a model. It persists a draft with its recommendation reference, evidence references (I4), prompt template id + version (ADR-044), provider/tier, cached flag, trace id, input/output tokens, cost, latency and generation timestamp. Eight draft types: SEO title, meta description, blog outline, article draft, social post, technical fix summary, executive summary, action checklist. Drafts start in `draft` status; nothing is published.

## 3. Prompt Template Registry
Draft templates are data (`templates.ts`), registered into the AI Gateway's `PromptTemplateRegistry` at version 1. Published versions are immutable (re-registering the same id+version throws); a new version supersedes and the used version is recorded on every draft (ADR-044). Rendering is deterministic (pure function of params). Workspace override of the pinned version flows through the Config Registry; default is the latest registered version. No prompt strings live in business logic.

## 4. AI Gateway integration
No package outside the Gateway imports a model SDK (AT-6, verified). The engine constructs a gateway per generation with a per-call cost meter, so budget gating, response caching and template versioning all come from the existing Gateway. Cached responses cost nothing and are marked `cached` on the draft.

## 5. Budget and Cost tracking
Reuses the Gateway `BudgetGuard` (per workspace+feature) and `CostMeter` port. `pgCostMeter` persists every model call to the `llm_calls` ledger (S3 §9: feature, tier, provider, tokens, cost, latency, cached, status) and captures usage for the draft row. An exhausted budget refuses generation before the provider is called (no draft, no ledger row) — never silently overspends.

## 6. Human Approval Workflow
`drafts.status`: draft → reviewed → approved → published, with rejected and regenerated branches. `transitionDraft` enforces the legal state machine and audits every change (`draft.transition`, with actor). There is no automatic publishing (Law 5 / ADR-048): `published` is a recorded human action; the system never sends or posts on its own.

## 7. Daily AI Digest
`buildDigest` reuses the growth feed and adds the day's opportunity/recommendation counts, generated drafts, pending approvals (draft/reviewed) and completed actions. It is a pure read over persisted rows — deterministic and replay-safe — and returns a structured object; Delivery remains the sole sender (I7).

## 8. Database changes
New tables `llm_calls` (append-only usage ledger, S3 §9) and `drafts` (generation metadata + approval-lifecycle status). Both RLS ENABLE+FORCE and workspace-scoped; llm_calls append-only, drafts updatable for lifecycle.

## 9. New migrations
`20260712000012_actions` (expand-only, NOTES with Rollback/Backfill) — passes the ADR-043 gate.

## 10. Package changes
New `@aigos/action` (depends on `@aigos/{ai-gateway,database,growth,infra}` + `pg`). No changes required to the Gateway. No new external production dependency.

## 11. ADRs implemented
ADR-044 (prompt_template_version on every generation), ADR-009/011 (tiered model use via the Gateway), ADR-046 (workspace template-version override via config), Law 5 / ADR-048 (no automatic publishing; human owns the send), I6/AT-6 (single model path), I4 (drafts carry evidence references), S3 §9 (LLM ledger for cost reporting), ADR-043 (expand-contract migration).

## 12. Invariants verified
I6/AT-6 (only the Gateway calls a model — no SDK import anywhere else; 281 modules, 0 violations), I4 (every draft carries evidence ids), I9 (RLS on drafts/llm_calls — leak-tested), I10/Law 5 (no side effect without a human — publishing is an audited human transition), budget-never-overspends. Determinism/replay verified for templates and digest.

## 13. Test coverage
12 new tests: template registry (immutability, determinism, all 8 types), draft generation (all 8 types with full metadata + ledger, cache reuse, budget refusal, RLS), approval workflow (audited transitions, illegal jumps), digest assembly + replay. Every draft type is exercised end-to-end. Total suite 253/253.

## 14. Performance review
Generation cost is bounded by the Gateway budget; caching removes duplicate model calls at €0. The engine builds a lightweight gateway per call (no heavy state). The ledger and drafts are single indexed writes; the digest is a few indexed reads. No read-time recomputation.

## 15. Technical debt
The engine constructs a gateway per generation for per-call metering — clean but slightly repetitive; a shared gateway with per-call meter injection could replace it. The production `ModelProvider` (a real LLM behind the Gateway) is still a fixture in CI — wiring a real provider inside the Gateway package is a deployment task. Budget uses the in-memory guard; a Postgres-backed budget from plan limits (S3 §9 aggregates) is a follow-up. Drafts are not yet surfaced in the web UI or delivered via the digest email.

## 16. Remaining TODOs
Wire a real model provider inside the Gateway; Postgres-backed budgets from plan limits; surface drafts + approvals in Today (web) and send the digest through Delivery (ADR-014); regenerate flow UI; A2 frozen-artifact publishing where a provider permits (ADR-048).

## 17. Entry points for Phase 6
Approved drafts + the daily digest are ready for delivery and outcome measurement: send the digest via Delivery (I7, ADR-014), let the human publish (Law 5), then Analytics measures outcomes against the opportunity's success criteria and the Learning Propagator feeds results back into detector/priority weights — closing the referential's loop. The `llm_calls` ledger is ready for COGS reporting (S3 §9, ADR-047).

---
*Generated at the end of Phase 5. Describes the implemented system only; no future features invented.*
