# AI Growth OS — Section 2: System Architecture

**Status:** Proposed v1 — pending founder review
**Author:** Principal Architect / Acting CTO
**Governing principles:** Action First (P1) · Tiered Intelligence Ladder (D3) · Architecture Evolution Principle · Security elevated to priority #2

---

## 0. Architectural Thesis

One paragraph before the diagrams, because it governs everything below.

The system is a **modular monolith** organized around a single central entity — the **Action** — fed by a **signal ingestion pipeline** and a **tiered intelligence ladder** in which LLM calls are the scarcest resource. All external platforms sit behind **adapters**. All model calls pass through one **AI Gateway**. One Postgres database, one Redis, one job queue, one deployable unit. Every component below states its scaling trigger — the observable condition under which it gets replaced. Until a trigger fires, the simple version stays.

---

## 1. High-Level Architecture Diagram

```
                          ┌─────────────────────────────┐
                          │        FRONTEND (Web)        │
                          │  Next.js · mobile-first PWA  │
                          │  Core surface: Action Feed   │
                          └──────────────┬──────────────┘
                                         │ HTTPS (REST + SSE)
┌────────────────────────────────────────▼────────────────────────────────────────┐
│                        MODULAR MONOLITH (single deployable)                      │
│                                                                                   │
│  ┌───────────┐ ┌────────────┐ ┌───────────────┐ ┌──────────────┐ ┌────────────┐ │
│  │ Identity  │ │ Connections│ │   Ingestion    │ │ Intelligence │ │   Action   │ │
│  │ & Tenancy │ │ (OAuth,    │ │ (adapters,     │ │ (rules,      │ │   Engine   │ │
│  │           │ │ token vault│ │ normalization) │ │ scoring,     │ │ (lifecycle,│ │
│  │           │ │ )          │ │                │ │ embeddings)  │ │ priority)  │ │
│  └───────────┘ └────────────┘ └───────────────┘ └──────┬───────┘ └─────┬──────┘ │
│                                                         │               │        │
│  ┌───────────┐ ┌────────────┐ ┌───────────────┐ ┌──────▼───────┐ ┌─────▼──────┐ │
│  │ Feedback &│ │ Delivery   │ │ Billing &      │ │  AI GATEWAY  │ │ Knowledge  │ │
│  │ Outcomes  │ │ (notifs,   │ │ Admin          │ │ (sole path   │ │ Base       │ │
│  │           │ │ digests)   │ │                │ │  to LLMs)    │ │            │ │
│  └───────────┘ └────────────┘ └───────────────┘ └──────┬───────┘ └────────────┘ │
└─────────────────────────┬───────────────────────────────┼────────────────────────┘
                          │                               │
              ┌───────────▼───────────┐         ┌─────────▼─────────┐
              │  Postgres (primary)   │         │  LLM Providers    │
              │  + pgvector           │         │  (Anthropic, etc.)│
              ├───────────────────────┤         └───────────────────┘
              │  Redis                │
              │  (cache + job queue)  │         ┌───────────────────┐
              ├───────────────────────┤         │ External Platform │
              │  Object storage (S3)  │◄────────┤ APIs: GSC, GA4,   │
              │  raw payloads/backups │         │ LinkedIn, X, etc. │
              └───────────────────────┘         └───────────────────┘

              Background workers (same codebase, separate process):
              ingestion jobs · intelligence pipeline · outcome evaluation ·
              digest generation · scheduled recomputes
```

Two runtime processes from one codebase: **web** (API + SSR) and **worker** (queue consumers + scheduler). That's the whole deployment topology at launch.

---

## 2. Core Modules (Domain Boundaries)

Modules are folders with enforced boundaries (import-linting), not services. Each answers the four mandatory questions; I summarize existence-reason and scaling trigger.

| Module | Why it exists | Scaling trigger to split it out |
|---|---|---|
| **Identity & Tenancy** | Auth, accounts, workspace scoping. Every row in the system carries `workspace_id`. | Enterprise SSO demand or team/agency multi-workspace features. |
| **Connections** | OAuth flows, encrypted token vault, connection health monitoring. | Never split lightly — it's the security core. Trigger: dedicated compliance regime (SOC 2 audit isolation). |
| **Ingestion** | Platform adapters, rate-limit management, raw payload capture, normalization into `Signal`s. | Sustained queue lag > 5 min at peak, or one provider's volume dwarfing others. |
| **Intelligence** | Tiers 0–2 of the ladder: rule engine (rules-as-data), deterministic scoring, embedding similarity. | CPU-bound scoring saturating workers. |
| **AI Gateway** | Tiers 3–4. Sole path to any model. Owns model selection, prompt/context budgets, caching, KB lookup, cost metering. | Multiple internal consumers with conflicting SLAs (unlikely before year 2). |
| **Action Engine** | The product. Generates, prioritizes, deduplicates, and manages the lifecycle of Actions. | N/A — this is the core domain and stays central. |
| **Knowledge Base** | Precomputed growth heuristics + learned per-workspace patterns (D3 tier-0 answers). | Vector volume beyond pgvector comfort (~tens of millions of embeddings). |
| **Feedback & Outcomes** | Records accept/dismiss/complete; scheduled outcome-evaluation jobs against success criteria; feeds scoring. | N/A. |
| **Delivery** | Notification policy, daily digest assembly, SSE to frontend. | Push-notification volume requiring dedicated infra. |
| **Billing & Admin** | Plans, usage limits (including per-user LLM budget enforcement), internal admin panel. | Standard. |

**Boundary rule:** modules communicate through explicit interfaces and domain events on the job queue — never by reaching into each other's tables. This is what keeps the future service-extraction option open at near-zero present cost.

---

## 3. Data Flow (the one flow that matters)

```
External platform ──▶ Adapter ──▶ Raw payload → object storage (immutable)
                                   │
                                   ▼
                            Normalize → Signal (Postgres)
                                   │
                                   ▼
                     TIER 0  Rule engine (rules-as-data)      ── 90% stop here
                                   ▼
                     TIER 1  Deterministic scoring             ── most of rest stop
                                   ▼
                     TIER 2  Embedding similarity vs KB        ── cheap
                                   ▼
                     TIER 3  Small model (classify/summarize)  ── via AI Gateway
                                   ▼
                     TIER 4  Frontier model (strategy/writing) ── rare, budgeted
                                   │
                                   ▼
                          Candidate Action ──▶ Action Engine
                     (dedupe, priority score, confidence, cap)
                                   │
                                   ▼
                     Action Feed (UI) / Notification (Delivery)
                                   │
                          user accepts / dismisses / completes
                                   ▼
                     Feedback & Outcomes ──▶ adjusts scoring weights
                                   │              and KB entries
                                   └──▶ shadow sample (1–2% of tier-0
                                        rejects escalated for audit — R7)
```

Key properties: raw payloads are kept immutably (reprocessing is always possible when normalization improves); every tier transition is logged with a reason (observability of the ladder); the feedback loop is in the launch scope, not a later phase — it's the learning signal the whole vision depends on.

---

## 4. Backend Architecture

**ADR-001 — Language & framework: TypeScript end-to-end (Node.js backend + Next.js frontend) in a single monorepo.**

- **Context:** Small team, one deployable, heavy integration work (OAuth, REST APIs, webhooks), AI accessed via HTTP APIs — not local ML.
- **Alternatives:** (a) Python/FastAPI backend + TS frontend — better data/ML ecosystem, but two languages doubles context-switching and duplicates domain types across a serialization boundary. (b) Full Python incl. templated frontend — poor fit for the interactive Action Feed UX.
- **Why TS:** the tiered ladder means our "AI work" is orchestration and HTTP, where TS is fully adequate. Shared types between API and UI eliminate a whole class of contract bugs. One language = one toolchain = velocity for a small team.
- **Trade-off accepted:** if we later need in-house ML (custom ranking models), that becomes a small dedicated Python service behind an internal API. That's the documented migration path, and it's cheap.
- **Framework:** NestJS or equivalent structured framework for the API/worker code — the module-boundary discipline matters more than the specific framework.

Structure: `apps/web`, `apps/api`, `apps/worker`, `packages/domain` (shared types + pure business logic), `packages/adapters` (one package per external platform). Business logic lives in `domain`, framework-free and unit-testable.

---

## 5. Frontend Architecture

Next.js, mobile-first, installable PWA. **The home screen is the Action Feed, not a dashboard** — this is P1 made concrete. Charts exist only inside an Action's "why this matters" evidence drawer.

- Server-rendered feed for fast first paint; SSE for live updates (new high-priority Action arrives → feed updates). No WebSocket infra needed at launch.
- Feed is hard-capped (default 5 actions/day, user-adjustable 3–10) per the open question I raised earlier — I'm now converting that into a decision: **D7: the daily feed is capped; the backlog exists but is deliberately secondary UI.**
- Each Action card renders the full contract: priority, impact tier, confidence, time estimate, rationale, prerequisites, deep link, success criteria, and accept/dismiss/snooze controls.
- State: server as source of truth; minimal client state (React Query or equivalent). No client-side state empire.

**Challenge to a likely future spec:** if Section 5 (Dashboard & UX) arrives describing a traditional analytics dashboard as the home surface, I will push back with this section as precedent.

---

## 6. Database Strategy

**ADR-002 — Single Postgres as primary store, with pgvector, until measured triggers fire.**

- Postgres holds: tenancy, connections metadata, Signals, Actions, rules (as data), KB entries + embeddings (pgvector), feedback, audit log, LLM usage ledger.
- Redis: cache + queue backing only. **Nothing durable lives in Redis.**
- Object storage (S3-compatible): raw API payloads, exports, backups.
- Multi-tenancy: shared tables with `workspace_id` on every row, enforced by a mandatory query-scoping layer in the data-access package (and Postgres RLS as defense-in-depth — belt and suspenders, because tenant leakage is a company-ending bug class).
- Time-series signal data: plain Postgres tables with monthly partitioning on `signals`. **Not** TimescaleDB/ClickHouse yet.
- **Scaling triggers:** read replicas when p95 read latency degrades under load; ClickHouse (or similar) only when analytical queries over signals demonstrably harm OLTP performance; dedicated vector DB only past pgvector's comfortable range.
- Retention (answers R2 partially): raw payloads 90 days hot then archived to cold storage; normalized signals aggregated after 13 months (keep rollups, drop granular rows). Declared now so the data model includes rollup tables from day one.

---

## 7. Queue & Background Processing

**ADR-003 — Redis-backed job queue (BullMQ) + database-driven scheduler. No Kafka.**

- Job families: `ingest.*` (per-provider polling/webhooks), `intelligence.*` (ladder processing), `actions.*` (generation, dedupe, expiry), `outcomes.*` (scheduled success-criteria evaluation — the closed loop), `digest.*`, `maintenance.*` (rollups, archival).
- Every job: idempotent (keyed), bounded retries with backoff, dead-letter queue with alerting. Idempotency is non-negotiable because provider APIs will make us retry constantly.
- Scheduler: recurring job definitions in Postgres (visible, auditable), executed via the queue. Per D6's spirit: schedules are data, not code.
- Per-provider rate limiting lives at the adapter layer with a shared token-bucket in Redis, so ten workers never collectively violate one API quota.
- **Scaling trigger for event streaming:** multiple independent consumers needing replay of the same event stream, or sustained throughput beyond Redis queue comfort (~thousands of jobs/sec). Neither is plausible before meaningful scale.

---

## 8. AI Gateway Architecture

The single most important cost-control component (D4, D5). One internal module, one interface: `gateway.infer(request)`.

Responsibilities, in evaluation order per request:

1. **Answerable without a model?** KB lookup / cached response (with declared invalidation triggers per recommendation type — R8).
2. **Budget check:** per-workspace and per-feature monthly token budgets from Billing. Over budget → degrade gracefully (queue for tomorrow, or downgrade tier), never silently overspend.
3. **Model routing:** model registry maps request class → model + max context + max output. Registry is config/data, hot-swappable when providers change pricing or models improve.
4. **Context assembly discipline:** the gateway trims context to the declared budget for the request class. Callers can't dump the kitchen sink into a prompt.
5. **Execution:** retries, timeout, provider failover (secondary provider configured from day one — providers have outages and deprecations).
6. **Ledger:** every call logged — workspace, feature, model, tokens, cost, latency, cache-hit. This ledger is the data behind the per-feature LLM Budget reviews (D5) and per-user unit economics.

**Structured outputs:** all tier-3/4 calls that feed the Action Engine must return validated structured output (schema-checked). A malformed model response is an error, never something we "best-effort parse" into a user-facing recommendation.

---

## 9. Agent Orchestration Model

Here I explicitly challenge the framing that Section 1 and popular fashion suggest.

**ADR-004 — "Agents" are domain pipelines, not autonomous LLM entities. There is no agent-to-agent conversation.**

- Each "agent" (SEO Strategist, Trend Hunter, etc.) = a pipeline: subscribed signal types → tier 0–2 processing → optional gateway calls → candidate Actions. Deterministic, testable, mostly token-free.
- Coordination happens through **shared state** (Signals, KB, Actions in Postgres) and the **Action Engine's arbitration** (dedupe, global priority, feed cap) — not through agents messaging each other. A blackboard model, in classic terms.
- Why: autonomous multi-agent chatter is the least debuggable, least predictable, most expensive architecture available, and it directly violates D3. When two "agents" would recommend conflicting actions, the resolution belongs in one arbitration point with explicit rules — not in an emergent negotiation.
- The one legitimate future exception: a top-level "Growth Coach" synthesis step (tier 4, runs once daily per active workspace at most) that reviews the day's candidate Actions and composes the narrative "here's your day." That's a scheduled pipeline stage, not a free agent.
- **When Section 4 arrives, it will be reviewed against this ADR.**

---

## 10. Data Ingestion Pipeline

- **Adapter interface** (per D-standing): every provider implements `connect / healthCheck / pull(window) / handleWebhook / normalize`. Providers are swappable; the rest of the system only ever sees `Signal`s.
- Prefer webhooks/push where offered; poll where not, at per-plan frequencies (cost lever for R2: free tier polls daily, paid tiers hourly — polling frequency is a pricing feature, decided now).
- Raw-first: store the raw payload, then normalize. Normalizers are versioned; reprocessing raw history is a standard maintenance job.
- Connection health is user-facing: expired tokens and revoked scopes generate a prerequisite Action ("Reconnect LinkedIn — 2 minutes — required for social monitoring"). Even integration failures obey Action First.
- **Launch-scope recommendation (challenging Section 1's breadth):** start with the providers that are cheap, stable, and high-signal — Google Search Console, GA4, and *one* social platform chosen by target persona. LinkedIn/X/Meta APIs (R1) are expensive, restrictive, and revocable; each additional platform is a separate risk acceptance, not a checkbox. Section 7 must rank providers by (signal value ÷ API risk), and I'll hold it to that.

---

## 11. Security Boundaries

Security is priority #2 (amended earlier). Foundations in the MVP, per the Production Readiness Requirement:

- **Token vault:** OAuth tokens encrypted at rest with envelope encryption (KMS-managed keys), decrypted only in memory at point of use, never logged, never sent to the frontend. Access to the vault is a distinct code path with its own audit trail.
- **Tenant isolation:** scoped data-access layer + Postgres RLS (see §6).
- **Secrets:** managed secret store; nothing in env files in repos.
- **Audit log:** append-only table for auth events, connection changes, token access, admin actions, data exports.
- **Prompt-injection boundary:** all external content (posts, comments, competitor pages) entering a model prompt is untrusted data. The gateway wraps it in delimited data blocks, and system instructions never originate from ingested content. Any model-proposed *action with side effects* (posting, sending) requires explicit user confirmation — at launch, the system drafts, the human sends. Full automation (Section 14) must be re-reviewed against this boundary.
- **GDPR from day one** (EU founder base is certain): data export, account deletion cascading through raw payloads and embeddings, DPA-ready processor list, EU region hosting by default.
- Standard hygiene: TLS everywhere, short-lived sessions with rotation, rate limiting on auth endpoints, dependency scanning in CI.

---

## 12. Deployment Strategy

**ADR-005 — Managed containers on one cloud region; no Kubernetes.**

- Two container services (web, worker) on a managed runtime (e.g., Fargate/Cloud Run/Render-class), managed Postgres with PITR backups, managed Redis, S3.
- Infrastructure as code from the first deploy (Terraform or equivalent) — this is cheap now and priceless later.
- CI/CD: every merge → tests → migration check → staged deploy. Migrations forward-only, backward-compatible with the previous release (enables zero-downtime deploys and instant rollback of app code).
- Environments: production + staging. Staging uses sandbox/test provider accounts, never production tokens.
- **Scaling trigger for K8s:** genuinely heterogeneous workloads needing custom scheduling/GPU pools. Not before.

---

## 13. Monitoring & Observability

- Structured JSON logs with request/job correlation IDs across web and workers.
- Error tracking (Sentry-class) on frontend and backend from day one.
- Metrics with alerting on a small set of *product-truth* signals, not vanity dashboards: queue lag per job family, adapter error rates per provider, ladder tier-transition rates (is the funnel behaving? — R7), gateway cost per workspace per day (alert on anomaly — a runaway loop is a real financial incident), Action feed generation success rate, and outcome-evaluation completion rate.
- The **LLM ledger (§8)** doubles as the cost-observability backbone: per-feature €/user/month is a queryable fact, not an estimate.
- Synthetic canary: a fake workspace with scripted signals runs the full ladder hourly; if it stops producing expected Actions, we know before users do.

---

## 14. Cost Considerations

Order-of-magnitude monthly model at launch scale (≈1,000 active workspaces), stated so it can be attacked:

- Infra (containers, Postgres, Redis, storage, egress): low hundreds of €.
- LLM spend, *with the ladder enforced*: target ceiling **€0.30–0.80 per active workspace/month** (tier-4 calls limited to ~1 daily synthesis + a handful of on-demand generations; tier-3 in the hundreds of small calls; tiers 0–2 free). Budget enforcement in the gateway makes this a hard ceiling, not a hope.
- External APIs: the real wildcard (R1/R2). GSC/GA4: free. Social/SERP data: potentially the largest line item — this is why provider selection in Section 7 is a business decision, not a technical one.
- Implication for pricing: COGS per paid user should land under ~€3/month at launch scope, leaving healthy margin at a €29–49 price point. If a future feature breaks this, its LLM Budget annotation (D5) will show it before we build it.

---

## 15. Scaling Roadmap (trigger-driven, not date-driven)

| Stage | Trigger (measured) | Change |
|---|---|---|
| 0 → now | — | Architecture above, single region |
| 1 | p95 API latency degrades / worker CPU sustained >70% | Horizontal scale of web & worker (stateless by design — no code change) |
| 2 | OLTP harmed by analytical queries | Read replica; move signal analytics to replica |
| 3 | Signal analytics still too heavy | ClickHouse/warehouse for signals; Postgres keeps OLTP |
| 4 | Queue replay/multi-consumer needs | Introduce event streaming (Kafka-class) for the ingestion bus only |
| 5 | One module's team/load diverges | Extract that module to a service along the existing boundary |
| 6 | Data-residency contracts | Multi-region tenancy |

The monolith's module boundaries + queue-based communication are precisely what make each row a bounded project instead of a rewrite.

---

## Appendix A — ADR Index

| ID | Decision | Status |
|---|---|---|
| ADR-001 | TypeScript end-to-end, monorepo, NestJS-class backend | Proposed |
| ADR-002 | Single Postgres + pgvector; Redis non-durable; S3 raw store | Proposed |
| ADR-003 | BullMQ + DB-driven scheduler; no event streaming at launch | Proposed |
| ADR-004 | Agents = deterministic pipelines + central arbitration; no agent-to-agent LLM dialogue | Proposed |
| ADR-005 | Managed containers, IaC, single region, no K8s | Proposed |
| ADR-006 | (Reserved for Section 3 — schema of Signal/Action/KB) | — |

## Appendix B — Architecture Review Delta (v0.2)

**New decisions:** D7 (capped daily feed, backlog secondary); launch providers narrowed to GSC + GA4 + one social platform (proposal — needs founder ratification); polling frequency as pricing tier lever; human-confirms-all-side-effect-actions at launch.

**New risks:**
- R9: Prompt injection via ingested third-party content → mitigated at gateway boundary (§11), re-review at Section 14 (Automation).
- R10: LLM provider outage/deprecation → secondary provider failover in gateway.
- R11: Runaway model-call loop = financial incident → hard per-workspace budget + anomaly alerting.

**Open questions for founder:**
1. Which single social platform at launch? (Determines persona focus and dominates R1 exposure — my instinct says LinkedIn for the founder persona, but its API is among the most restrictive; this needs a Section 7 deep-dive.)
2. Ratify the €29–49 launch price band assumption? It sets the COGS ceiling every LLM Budget will be measured against.
3. EU-region hosting by default — confirm target market includes EU (GDPR posture changes if purely US).
