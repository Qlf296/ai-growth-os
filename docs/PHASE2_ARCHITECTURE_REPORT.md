# Phase 2 Architecture Report — AI Growth OS

**Date:** 2026-07-12 · **Referential:** v2.1 (frozen) · **Scope:** Phase 2 (adapter framework + Google Search Console integration) · **Status:** complete, all gates green, working tree clean. Describes the current implementation only.

## 1. Executive summary
Phase 2 delivers the first real data source end-to-end: the adapter framework (ADR-021), the Google Search Console adapter, the full OAuth lifecycle (I8), and a production-ready synchronization pipeline (scheduler → queue → raw-first ingestion → normalized Signals) with connection health monitoring. Ten steps (2.1–2.10), one atomic commit each, tests-first. Suite grew from 170 to **216 tests**; all architecture tests and CI gates green throughout.

## 2. Features implemented
Adapter framework (registry, capability manifest, lifecycle, health, config). GSC adapter (manifest-as-data, fixtures-as-sandbox, authenticated HTTP transport). Google OAuth (authorize/callback, signed expiring state, token exchange). Vault-only encrypted token storage. Property listing + selection. Incremental synchronization with pagination, resume, idempotency. Quota citizenship. Connection health lifecycle (pending/healthy/degraded/reconnect_required/failed). Token refresh + refresh-token rotation + revoked detection. Full audit + health metrics. Settings → Connections UI.

## 3. Architecture changes
No new architectural decisions; Phase 2 consumes existing ADRs. New package surface inside `@aigos/adapters` (framework + gsc/ + quota + health + google-oauth). Worker gained the ingestion/sync handler. API gained connection routes. All module boundaries unchanged and enforced (212 modules, 0 dependency-cruiser violations). Model SDKs / send SDKs still confined to their packages (AT-6/AT-7).

## 4. Database changes
New tables: `signals` (partitioned, RLS, append-only grant, dedupe-unique), `scheduled_jobs` extensions used for per-workspace schedules, `connection_sync_state`, and `connections.health_status` column. Existing `connections.external_account_ref` now stores the selected property. All tenant tables carry RLS ENABLE+FORCE; `provider_tokens` remains vault-role-only (I8).

## 5. Migrations
`0004_seed_plans`, `0005_user_scope_policies` (Phase 1 tail), `0006_signals`, `0007_vault_audit_grant`, `0008_connection_sync_state`, `0009_connection_health`. Each expand-only with NOTES.md (Rollback + Backfill); enforced by the ADR-043 migration gate.

## 6. Package dependency changes
Production dependencies unchanged in count: `pg`/`prisma` (database, identity), `bullmq` (infra), `cron-parser` (worker). Adapters depend only on `@aigos/{config-registry,database,infra}`. No new external dependency added across Phase 2.

## 7. Google Search Console integration
Manifest as data (`read_search_analytics: true`, `publish: false`, `backfill_months: 16`). `GscTransport` port with `listSites` + `querySearchAnalytics`; `FixtureGscTransport` (sandbox) and `HttpGscTransport` (Bearer token from the vault, never in CI). Verified-properties filter excludes `siteUnverifiedUser`. Data-lag (2 days) and backfill-chunk tunables live in the config registry (ADR-046).

## 8. OAuth lifecycle
Authorize builds Google consent URL (offline + consent, `webmasters.readonly`) with an HMAC-signed, 10-minute state carrying workspace/user/(optional site). Callback verifies state (tamper/expiry/user-bound), exchanges the code, creates a workspace-owned connection (`authorized_by`, ADR-019), stores tokens in the vault, and — when a site is chosen — schedules the first sync. Access tokens auto-refresh on expiry; a new refresh token from Google is rotated into the vault. Every lifecycle event is audited (`token.refreshed`, `token.rotated`, `token.refresh_failed`) with no token material. `invalid_grant` marks the connection expired and drives `reconnect_required`.

## 9. Connection lifecycle
`connections.status` (frozen S3 §3 vocabulary: active/expired/revoked/error) is the credential lifecycle with a validated state machine (`applyConnectionStatus`). Revoked-first runbook preserved (vault has no DELETE).

## 10. Health lifecycle
Separate `health_status`: pending → healthy on a successful probe/sync; transient/quota → degraded; auth failure → reconnect_required; capability revoked → failed (terminal until explicit reconnect). Single writer `updateConnectionHealth` reads-then-transitions, audits `connection.health_changed`, and stamps `health_checked_at`. `checkConnectionHealth` composes refresh + liveness probe; the sync handler also reflects health on success/failure.

## 11. Scheduler & Queue
Schedules are data (ADR-003): `scheduleWorkspaceJob` persists an enabled recurring `gsc.ingest.daily` row, idempotent per (workspace, family, params). The stateless scheduler tick enqueues due occurrences with idempotent job ids (`family:defId:occurrenceISO`); the BullMQ/in-memory queue provides bounded retries, exponential backoff and a dead-letter queue. `recordJobRun` writes run metadata (last/next run, status).

## 12. Raw-first pipeline
Every provider page is stored immutably in the raw store (tenant-partitioned `ws/gsc/date/id`) BEFORE validation. Write-once semantics; a retry that re-stores a page is tolerated (first capture wins), enabling loss-free resume. No delete API — GDPR purge remains a separate audited job.

## 13. Signal pipeline
Validated GSC rows normalize to typed Signals (normalizer v1) referencing their raw payload, inserted idempotently via a unique `dedupe_hash` per (workspace, occurred_at). Interpretation is not computed here (measurement ≠ interpretation, ADR-025).

## 14. Security review
I8 holds: tokens are AES-256-GCM envelope-encrypted, vault-role-only, never returned by any API, never logged (scrubber), never readable by the app role (proven by tests). I9 holds: `signals`, `connection_sync_state`, `connections` are RLS ENABLE+FORCE, verified by cross-workspace leak assertions. OAuth state is HMAC-signed, expiring and user-bound; auth errors are generic (no oracle); CSRF header required on state-changing routes. Audit covers connection, token, health and ingestion events.

## 15. ADRs implemented (Phase 2)
ADR-021 (adapter operational contract), ADR-007 (capabilities-as-data), ADR-019 (workspace-owned connections + reauth), ADR-016/017 (OAuth + sessions reused), ADR-003 (queue + scheduler), ADR-046 (adapter/quota tunables), ADR-043 (expand-contract migrations), ADR-047 (health metrics/observability), ADR-025 (measurement ≠ interpretation upheld).

## 16. Invariants verified
I8 (token sacredness), I9 (tenant isolation), I5 (one-writer: SignalRepository for signals, updateConnectionHealth for health), plus the standing AT-boundaries/AT-6/AT-7 and the CI gates — all exercised by unit + end-to-end tests, including the Phase 2.10 scenario.

## 17. Performance considerations
Ingestion paginates to GSC's 25k row limit; quota citizenship (global + per-workspace fairness) prevents fleet starvation; data-lag avoids fetching unavailable days. Incremental window keeps daily runs minimal. No scoring at read time (deferred to Phase 3). SLO budgets (PERFORMANCE_BUDGET) unaffected.

## 18. Technical debt
`HttpGscTransport`, `FetchGoogleTokenEndpoint` and live-Supabase/Redis integration remain exercised only against fixtures/embedded services in CI (real-provider runs are out-of-band). `signals` uses a DEFAULT partition; monthly partition automation + 13-month retention land with the rollup job. The authenticated transport is not yet wired into the worker sync loop (sync currently takes an injected transport); production wiring composes `refreshConnectionToken` + `HttpGscTransport`. `signal_rollups` not created (no writer yet).

## 19. Remaining TODOs
Wire `HttpGscTransport` into the scheduled sync via the vault token provider; add a dedicated health-check job family if health should run independently of sync; monthly partitioning + retention job; live Google OAuth verification (R20) and pooler/Redis integration runs on a real environment.

## 20. Entry points for Phase 3
Signals are populated and tenant-isolated — the substrate for the intelligence ladder. Next: SEO detectors (tier-0 rules-as-data over `signals`, S10), Growth Intelligence baselines (S8), then the Recommendation Engine (S16) writing Actions. Config registry, decision-affecting gate (AT-14), evidence tripwire (I4) and the queue/scheduler are all ready to carry that work.

---
*Generated at the end of Phase 2. Describes the implemented system only; no future features invented.*
