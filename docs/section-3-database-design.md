# AI Growth OS — Section 3: Database Design

**Status:** Proposed v1 — pending founder review
**Depends on:** Section 2 (ADR-001..005), Founder Decisions (LinkedIn-first w/ API constraints, freemium @ €29 target, EU/GDPR, ForgCV-first)
**Prime directive for this section:** the schema must make the *learning loop* (action → outcome → adjusted scoring) a first-class citizen. If the loop is bolted on later, the Section 1 vision dies quietly.

---

## 0. Design Stance

Five commitments that govern every table below:

1. **`workspace_id` on every tenant row, no exceptions.** Enforced by the data-access layer *and* Postgres RLS. ForgCV is workspace #1, never a code path.
2. **Hybrid state model, not full event sourcing.** Mutable current-state rows for fast queries + append-only event tables for history and learning. Full event sourcing was considered and rejected (ADR-006): it maximizes replay purity at the cost of operational complexity we don't need; the append-only event tables give us 90% of the benefit.
3. **Typed core + JSONB edges.** Columns for everything we filter/join/aggregate on; JSONB for provider-specific and evolving payloads. Schema-on-write where it earns its keep.
4. **Machine-evaluable success criteria.** Free-text success criteria would silently break the closed loop. Criteria are structured: `{metric, comparator, target, window}`. If a criterion can't be expressed that way, the Action gets `evaluability = 'manual'` and asks the user — honestly — instead of pretending.
5. **Append-only where money, security, or learning is involved:** `audit_log`, `llm_calls`, `action_events`, `outcome_evaluations` are insert-only (no UPDATE/DELETE grants).

---

## 1. Entity Map

```
Workspace ─┬─ Users (via Memberships)
           ├─ Subscription / PlanLimits
           ├─ Connections ──── ProviderTokens (vault, restricted)
           ├─ Signals (partitioned) ──▶ raw payload in S3 (key ref)
           ├─ Rules (rules-as-data) + RuleStats
           ├─ Actions ─┬─ ActionEvents (append-only lifecycle)
           │           ├─ ActionEvidence (→ Signals)
           │           └─ OutcomeEvaluations (append-only)
           ├─ KBEntries (+ embeddings, pgvector)
           ├─ LLMCalls (ledger, append-only) / LLMBudgets
           ├─ ScheduledJobs (scheduler-as-data)
           └─ AuditLog (append-only)

Global (no workspace): Providers, ModelRegistry, GlobalKBEntries, Plans
```

---

## 2. Tenancy & Identity

```sql
workspaces (
  id uuid PK, name text, region text DEFAULT 'eu',
  plan_id text REFERENCES plans, created_at, deleted_at  -- soft delete → GDPR purge job
)

users (
  id uuid PK, email citext UNIQUE, auth_provider text,
  locale text DEFAULT 'fr', created_at, deleted_at
)

memberships (
  workspace_id, user_id, role text CHECK (role IN ('owner','admin','member')),
  PRIMARY KEY (workspace_id, user_id)
)

plans (
  id text PK,            -- 'free' | 'creator' | 'growth' | 'agency'
  limits jsonb           -- {daily_actions: 5, connections: 1, tier4_calls_month: 0, poll_freq: 'daily', ...}
)
```

- Plan limits are **data**, consumed by the gateway (LLM budgets) and the scheduler (poll frequency). Free tier: `tier4_calls_month: 0` → free users run on ladder tiers 0–2 + KB reuse. This is how "free" stays near-zero COGS.
- Roles are minimal on purpose. Agency-tier RBAC is a documented future migration (add `teams`), not speculative tables today.
- GDPR: `deleted_at` triggers a purge pipeline: rows, S3 raw payloads, embeddings, and ledger anonymization (keep costs, drop identity). Export = per-workspace dump job. Both are launch scope, per §11 of Section 2.

## 3. Connections & Token Vault

```sql
connections (
  id uuid PK, workspace_id, provider text,      -- 'gsc' | 'ga4' | 'linkedin' | ...
  status text,                                   -- 'active' | 'expired' | 'revoked' | 'error'
  scopes text[], external_account_ref text,
  capabilities jsonb,   -- ★ what THIS provider actually permits: {read_own_posts: true, read_feed: false, publish: 'deeplink_only'}
  health_checked_at timestamptz, created_at
)

provider_tokens (        -- separate table, separate grants, envelope-encrypted
  connection_id PK/FK, enc_access_token bytea, enc_refresh_token bytea,
  key_id text, expires_at timestamptz, rotated_at timestamptz
)
```

- **`capabilities` encodes the LinkedIn reality as data.** Pipelines consult capabilities, never provider names. When LinkedIn loosens (or Reddit lands), it's a capabilities update, not a schema or code change. This is the schema-level answer to R1.
- `provider_tokens` has its own restricted DB role; the app's default role cannot SELECT it. Only the vault code path (audited) can.

## 4. Signals

```sql
signals (
  id uuid, workspace_id, connection_id,
  source text, type text,          -- e.g. 'gsc.query_stats' | 'ga4.traffic_day' | 'linkedin.own_post_stats'
  external_id text, occurred_at timestamptz, ingested_at timestamptz,
  payload_ref text,                -- S3 key of raw payload (immutable)
  data jsonb,                      -- normalized, normalizer_version int
  dedupe_hash text,
  ladder_state jsonb,              -- {t0:'passed', t1_score: 0.72, t2:'novel', escalated_to: 3, shadow_sample: false}
  PRIMARY KEY (workspace_id, occurred_at, id)
) PARTITION BY RANGE (occurred_at);  -- monthly partitions

signal_rollups (
  workspace_id, metric text, grain text,  -- 'day' | 'week' | 'month'
  period_start date, value numeric, dims jsonb,
  PRIMARY KEY (workspace_id, metric, grain, period_start, dims)
)
```

- `dedupe_hash` = provider + external_id + type; UNIQUE index per partition → idempotent ingestion (retries are free).
- **`ladder_state` makes the intelligence funnel observable per signal** — this is how we audit R7 (false negatives) and tune tier thresholds with data instead of vibes. `shadow_sample: true` marks the 1–2% escalated-anyway audit population.
- Retention per ADR-002: partitions >13 months dropped after rollup verification; raw S3 payloads to cold storage at 90 days. Rollups exist from day one, so retention is a `DROP PARTITION`, never a crisis migration.

## 5. Rules-as-Data (Ladder Tier 0)

```sql
rules (
  id uuid PK, workspace_id NULL,   -- NULL = global default; workspace row overrides
  scope text,                      -- signal type it applies to
  condition jsonb,                 -- declarative predicate AST, versioned
  outcome text,                    -- 'drop' | 'escalate' | 'create_action:<template>'
  enabled bool, version int, updated_by, updated_at
)

rule_stats (rule_id, day date, hits int, escalations int, actions_created int,
            PRIMARY KEY (rule_id, day))
```

- Per D6: thresholds editable without deploys; `rule_stats` shows dead or over-firing rules at a glance. A rule with 30 days of zero hits gets flagged for review by a maintenance job — rules rot, so the system watches its own rules.

## 6. Actions — the Core Entity (ADR-006)

```sql
actions (
  id uuid PK, workspace_id,
  category text,        -- 'seo' | 'social' | 'community' | 'technical' | 'outreach' | 'review'
  origin text,          -- pipeline that produced it, e.g. 'seo_strategist'
  origin_tier smallint, -- highest ladder tier used (0–4) → cost/quality analytics
  title text, rationale text,               -- the "why this matters"
  priority_score numeric, impact_tier text CHECK (impact_tier IN ('high','medium','low')),
  confidence text CHECK (confidence IN ('high','medium','low')),
  effort_minutes int, prerequisites jsonb,  -- [{type:'connection', provider:'linkedin'}, ...]
  deep_link text, draft_content_ref uuid,   -- prepared post/comment/email draft, if any
  success_criteria jsonb,   -- [{metric:'gsc.clicks', page:'/cv-templates', comparator:'>=', target:120, window_days:28}]
  evaluability text CHECK (evaluability IN ('auto','manual','none')),
  status text,          -- current state (denormalized from events for query speed)
  dedupe_key text, expires_at timestamptz,
  presented_on date,    -- which daily feed it appeared in
  created_at, updated_at,
  UNIQUE (workspace_id, dedupe_key)
)

action_events (   -- append-only; the learning substrate
  id bigserial PK, action_id, workspace_id,
  event text,     -- 'generated'|'queued'|'presented'|'accepted'|'snoozed'|'dismissed'|'completed'|'expired'|'outcome_recorded'
  meta jsonb,     -- dismissal reason, snooze_until, completion note...
  actor text,     -- 'user:<id>' | 'system'
  at timestamptz DEFAULT now()
)

action_evidence (action_id, signal_id_ref jsonb, weight numeric)  -- links to signals/rollups backing the rationale
```

**Lifecycle state machine** (enforced in domain code; events are the source of truth, `status` a projection):

```
generated ──▶ queued ──▶ presented ──▶ accepted ──▶ completed ──▶ outcome_recorded
                │            │            │
                │            ├─▶ snoozed ─┘ (returns to queued)
                │            └─▶ dismissed(reason)          ── reasons are enum + free text:
                └─▶ expired                                     'not_relevant'|'no_time'|'already_done'|'dont_understand'|'other'
```

- **Dismissal reasons are a product feature, not telemetry** — 'dont_understand' feeds copy improvements; 'not_relevant' down-ranks the category for that workspace (R6 mitigation, mechanically: a per-workspace `category_affinity` score computed nightly from events).
- `dedupe_key` (category + target entity + normalized intent) prevents the same advice resurfacing daily — recommendation spam is the fastest way to lose the user's trust in the feed.
- `draft_content_ref` supports the LinkedIn draft-and-deep-link reality: the system prepares, the human publishes.

## 7. Outcome Evaluations (the Closed Loop)

```sql
outcome_evaluations (   -- append-only; one row per criterion per evaluation run
  id bigserial PK, action_id, workspace_id,
  criterion_index int, evaluated_at timestamptz,
  observed_value numeric, verdict text,  -- 'met'|'partial'|'not_met'|'unmeasurable'
  baseline jsonb        -- captured AT ACTION CREATION: {metric_value_before, window}
)
```

- **The baseline is snapshotted when the Action is created**, not at evaluation time — otherwise we can't distinguish "action worked" from "trend continued." This detail is easy to miss and impossible to reconstruct retroactively; it's why outcomes are designed now.
- A scheduled `outcomes.evaluate` job fires at `completed_at + window_days`. Verdicts flow into: (a) per-category/per-origin scoring weight adjustments, (b) KB entries ("posts published Tuesday 9:00 outperform for this workspace"), (c) the honest track-record the UI can show ("of the 14 SEO actions you completed, 9 met their target").
- **Honesty rule:** `unmeasurable` is a legitimate verdict, displayed as such. Fabricated attribution would poison both trust and the learning loop.

## 8. Knowledge Base & Embeddings

```sql
kb_entries (
  id uuid PK, workspace_id NULL,        -- NULL = global growth heuristics; else learned per-workspace
  kind text,      -- 'heuristic' | 'learned_pattern' | 'cached_generation' | 'competitor_fact'
  topic text, content jsonb,
  embedding vector(1024),               -- pgvector; HNSW index
  source text,    -- 'curated' | 'outcome_loop' | 'tier4_generation'
  confidence numeric,
  invalidation jsonb,  -- declared triggers per R8: {ttl_days: 90} | {on_event: 'connection.changed'} | {on_metric_delta: {...}}
  valid_until timestamptz, created_at, last_used_at, use_count int
)
```

- One table, two scopes (global/workspace) — resolution order: workspace entry shadows global. ForgCV's specificity lives *here*, as workspace-scoped entries, honoring the no-special-code guardrail.
- `invalidation` is declared per entry class at write time (R8 resolved structurally): a cached "publish Tuesday 09:00" carries its own expiry conditions. A nightly job sweeps expired entries.
- `use_count`/`last_used_at` tell us which knowledge actually earns its storage — and which tier-4 generations were worth caching.
- Embedding model choice pinned in `ModelRegistry` with a `dimension` + `model_version`; re-embedding is a versioned maintenance job (same pattern as normalizer versions).

## 9. LLM Ledger & Budgets

```sql
llm_calls (   -- append-only; financial-grade
  id bigserial PK, workspace_id, feature text, request_class text,
  model text, tier smallint, input_tokens int, output_tokens int,
  cost_eur numeric(10,6), latency_ms int,
  cache_hit bool, kb_hit bool, budget_state text,  -- 'ok'|'degraded'|'blocked'
  at timestamptz
)

llm_budgets (
  workspace_id, feature text, month date,
  cap_eur numeric, spent_eur numeric,   -- spent updated transactionally with llm_calls insert
  PRIMARY KEY (workspace_id, feature, month)
)
```

- `spent_eur` maintained transactionally → the gateway's budget check is one indexed read; enforcement is hard, not eventual (R11).
- This ledger is the source for D5 reviews: `SELECT feature, sum(cost_eur)/count(DISTINCT workspace_id) FROM llm_calls WHERE month = ... GROUP BY feature` — €/user/month per feature is a query, not a guess.

## 10. Audit & Scheduler

```sql
audit_log (   -- append-only, INSERT-only grant
  id bigserial PK, workspace_id NULL, actor text, event text,
  target text, meta jsonb, ip inet, at timestamptz
)   -- auth events, token access, connection changes, exports, deletions, admin actions

scheduled_jobs (
  id uuid PK, workspace_id NULL, job_family text, schedule text,  -- cron expr
  params jsonb, enabled bool, last_run_at, next_run_at, last_status text
)
```

Scheduler-as-data per ADR-003: poll frequencies come from `plans.limits` → materialized into `scheduled_jobs` per workspace on plan change.

---

## 11. Multi-Tenancy Enforcement (defense in depth)

1. **Layer 1 — code:** the data-access package exposes only workspace-scoped repositories; an unscoped query requires an explicitly-named `dangerouslyUnscoped` API that is lint-flagged and code-review-gated.
2. **Layer 2 — Postgres RLS:** policies on every tenant table keyed to `current_setting('app.workspace_id')`, set per request/job. Even a bug in layer 1 cannot leak across tenants.
3. **Layer 3 — tests:** a standing integration test suite that attempts cross-tenant access through every repository. Red build if any path leaks.

---

## 12. ADRs Introduced

| ID | Decision | Key trade-off |
|---|---|---|
| ADR-006 | Hybrid state model: current-state rows + append-only event/ledger tables; full event sourcing rejected | Lose perfect replay; gain operational simplicity. Events cover the learning loop, which is what replay was for. |
| ADR-007 | Provider `capabilities` as data on connections; pipelines never branch on provider name | Slightly more indirection; LinkedIn's API reality becomes config, not architecture. |
| ADR-008 | Success criteria structured & machine-evaluable, baseline snapshotted at creation | Some actions honestly `unmeasurable`; we say so rather than fake attribution. |
| ADR-009 | Free tier structurally restricted to ladder tiers 0–2 (`tier4_calls_month: 0` in plan limits) | Free UX is rule/KB-driven; protects unit economics at €0 price point. |

## 13. Architecture Review Delta (v0.3)

**Resolved:** R8 (invalidation now structural, §8) · Launch platform = LinkedIn *within API reality* (draft + deep-link publish; no feed reading) · Pricing baseline €29 with free tier at ~€0 COGS · EU region + GDPR mechanics in schema (soft delete → purge, export job).
**New risks:**
- R12: LinkedIn value perception gap — users may expect "monitor LinkedIn for me," which the API forbids. Mitigation: honest onboarding copy + prioritize Reddit (readable API) early in Phase 2.
- R13: Outcome attribution noise — baselines mitigate but don't eliminate confounds; verdicts are labeled evidence, not proof.
**Open questions for founder:**
1. ForgCV's own product analytics (signups, conversions) — do we ingest them as a first-class provider (`forgcv` adapter) at launch? I recommend **yes**: it's the Revenue/Conversion metric source, it's our own API (zero risk), and it makes the dogfooding loop complete.
2. Dismissal down-ranking aggressiveness: after how many 'not_relevant' dismissals does a category get suppressed vs merely down-ranked? (Product taste question; default proposal: down-rank at 3, suppress with "re-enable" notice at 7.)
