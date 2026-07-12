# Phase 6 Architecture Report — AI Growth OS

**Date:** 2026-07-12 · **Referential:** v2.1 (frozen) · **Scope:** User Experience (dashboard + product pages over the existing architecture) · **Status:** complete, all gates green, working tree clean. Describes the current implementation only.

## 1. Executive summary
Phase 6 builds the full SSR user experience on top of the frozen architecture without changing it: the real Today dashboard and eight product pages, each reading exclusively from existing repositories/services. No new package was created and no invariant was weakened. Nine atomic steps (6.1–6.9), one commit each, tests-first. Suite grew from 255 to **268 tests**; architecture tests and CI gates green throughout.

## 2. Features implemented
Today dashboard (daily digest: summary + ranked active opportunities + recommendations). Opportunity detail page (details, recommendation, evidence with `evidenceReferenceId`, immutable status timeline). Action Center (all drafts with model/tokens/cost/evidence; review/approve/reject/archive). Experiments page (read-only, grouped by state, honest empty). Connections page (GSC status/health/site/scopes/last sync/reconnect). Notification Center (Delivery categories, honest empty history). Workspace Administration (workspace/members/roles/plan/limits/usage). AI Usage Dashboard (tokens/requests/latency/cache/provider/monthly cost/history). Performance hygiene (Cache-Control + pagination).

## 3. UI architecture
One runtime = SSR + API (S2 §1). Pages are pure string renderers in `apps/web/src/pages.ts`; routes in `apps/web/src/server.ts` guard the session directly and load data through repositories/readers, then render. HTML is escaped (`esc`); per-user responses carry `Cache-Control: private, no-store`. No client framework; small progressive-enhancement scripts call the existing API routes (CSRF-guarded).

## 4. Reused packages
`@aigos/action` (buildDigest, listDrafts, transitionDraft, usageSummary), `@aigos/growth` (buildFeed, getOpportunityDetail, transitionOpportunity), `@aigos/database` (ConnectionRepository, getSyncState, memberships, plans, llm_calls, provisioning, RLS scoping), `@aigos/identity` (SessionService), `@aigos/delivery` (notification categories), `@aigos/ai-gateway` (draft generation in tests). No business logic was duplicated in the web layer.

## 5. New migrations
None. Phase 6 is pure UI over existing tables.

## 6. Database changes
None (no schema changes). Reads only, plus the existing audited `transitionDraft`/`transitionOpportunity` writes.

## 7. Dependencies
`apps/web` now depends on `@aigos/action` (which pulls `@aigos/growth`); `apps/api` depends on `@aigos/action` for the draft-transition route. No new external dependency. Dependency graph clean (AT-boundaries green; no orphans; no cycles).

## 8. ADR compliance
ADR-031 (page-grouped opportunities surfaced), ADR-035/I4 (evidence always cited; a missing evidence reference fails loudly), ADR-018 (single-workspace Model-A UI), ADR-016/017 (session-guarded pages; reconnect reuses the OAuth flow), Law 5/ADR-048 (no auto-publish — Action Center only records human transitions), Law 15/ADR-034 (honest, unmonetized impact rendered), S5 (Today anatomy + honest zero-states), S6 §2 (CSRF on state-changing routes).

## 9. Invariants verification
I4 (evidence cited on opportunity pages; dangling reference throws — tested), I8 (refresh-token state derived from health/status; the web never reads the vault), I9 (every page reads inside a workspace RLS scope; cross-workspace data cannot render), I6/I7 (no model/send SDK imported in the web/api layer — AT-6/AT-7 green), audit trail intact (draft/opportunity transitions audited). 268/268 tests, 0 architecture violations.

## 10. Test summary
13 new tests across dashboard, opportunity, actions, experiments, connections, notifications, admin, usage and performance — each asserting real repository data (or honest empty state) and no fabricated content. Full suite 268/268; determinism/replay covered by the reused digest/feed tests.

## 11. Architecture summary
No architecture drift: no new packages, no schema, no invariant change, no new external dependency. Boundaries, RLS, AT-6/AT-7, migrations and CI gates all green. Dead-code and orphan scans clean; `evidenceReferenceId` enforced; audit events present for every lifecycle transition.

## 12. Technical debt
Experiments and Notification Center render honest empty states because their data sources (Experiment Engine; persisted delivery history) do not exist yet. Draft "regenerate" is not yet a UI action (lifecycle state exists). Per-item draft-status badges on Today are summarized rather than per-row. Carried from earlier phases: `@prisma/client`/`prisma` should be devDependencies (defer to a pinned-lockfile environment); real ModelProvider/HTTP transports still fixtures in CI.

## 13. Remaining work
Build the Experiment Engine and surface real experiments; persist a delivery/notification history and wire the digest through Delivery (ADR-014); expose accept→draft-generate→approve→publish as an end-to-end UI flow; add per-workspace budgets from plan limits to the Usage dashboard; connect lifecycle actions on the dashboard.

## 14. Phase 7 entry points
The UI now exposes the full loop surface: Today shows ranked, evidence-backed recommendations; the Action Center manages human approval (Law 16). Phase 7 can close the loop — deliver the daily digest (I7, ADR-014), let the human publish (Law 5), then measure outcomes (Analytics, grades A–F, ADR-033) and feed results back through the Learning Propagator into detector/priority weights. The Usage dashboard and `llm_calls` ledger are ready for COGS/budget reporting.

---
*Generated at the end of Phase 6. Describes the implemented system only; no future features invented.*
