# Phase 0 Architecture Report — AI Growth OS

**Date:** 2026-07-12 · **Referential:** v2.1 (frozen) · **Final commit:** `76f2eec` · **Status:** Phase 0 complete, all gates green, working tree clean.
**History:** 11 commits — one per BUILD_RULES step, each independently green.

---

## 1. Project Tree

```
ai-growth-os/
├── .dependency-cruiser.cjs        # AT-boundaries + AT-6/AT-7 (static architecture tests)
├── .github/workflows/ci.yml      # merge gates (required checks)
├── .unscoped-allowlist.json      # AT-unscoped enumeration (S3 §11)
├── apps/
│   ├── api/                      # node:http skeleton, /health (ADR-047)
│   │   ├── src/{index,server}.ts
│   │   └── test/server.test.ts
│   ├── web/                      # empty skeleton (UI = Phase 1)
│   └── worker/                   # scheduler tick + canary stub
│       ├── src/{index,scheduler,canary}.ts
│       └── test/scheduler.test.ts
├── docs/                         # frozen referential v2.1 (28 documents) + this report
│   └── shadow-evals/             # AT-14 artifacts (gate-enforced convention)
├── packages/
│   ├── adapters/                 # empty shell — providers land Phase 1 (ADR-021)
│   ├── ai-gateway/               # I6: sole model path — infer() shell, budgets, templates, cache
│   ├── config-registry/          # ADR-046: config-as-data, stability, AT-14 runtime gate
│   ├── database/                 # RLS tenancy, vault, migrations, repositories, PgConfigStore
│   │   └── prisma/migrations/    # 3 migrations, each with NOTES.md (ADR-043)
│   ├── delivery/                 # I7: sole send path — registry, budget, dedupe, cooldown
│   ├── domain/                   # framework-free shared types (fills in Phase 1)
│   ├── identity/                 # ADR-016/017: magic links + rotating server sessions
│   └── infra/                    # ADR-003 queue, cache, raw-first store, observability (ADR-047)
├── scripts/
│   ├── gates/                    # CI governance gates (code + tests)
│   └── proofs/                   # invariant violation proofs (BUILD_RULES step 11)
├── package.json                  # npm workspaces; scripts: test, test:arch, typecheck, gates
└── tsconfig{,.base}.json         # TS strict, project references
```

## 2. Counts

| Metric | Value |
|---|---|
| Packages (npm workspaces) | 11 — 8 `packages/*` + 3 `apps/*` |
| Modules cruised (dependency-cruiser) | 141, 0 violations |
| Source LOC (TypeScript, hors dist) | ~3 900 |
| Tests | **114**, 17 fichiers, 0 skip — dont AT-8/AT-9 sur PostgreSQL 18 réel |
| Migrations SQL | 3 (chacune : `migration.sql` + `NOTES.md` rollback/backfill) |
| Commits Phase 0 | 11 (un par étape BUILD_RULES) |

## 3. External Dependencies (production)

| Package | Where | Why (referential) |
|---|---|---|
| `pg` | database, identity | Postgres driver (ADR-002) |
| `prisma` / `@prisma/client` | database | schema mirror + `migrate deploy` in prod (ADR-043) |
| `bullmq` | infra | ADR-003 mandates BullMQ; brings its own ioredis |
| `cron-parser` | worker | cron exprs of scheduled_jobs (ADR-003, schedules-as-data) |

Dev-only: `typescript`, `vitest`, `dependency-cruiser`, `embedded-postgres` (harnais AT-9), `@types/*`.
**Refusés/évités** : ioredis direct (doublon bullmq), framework HTTP (P2 — node:http suffit), SDK S3 (port seul, driver au déploiement), SDK modèle/email (interdits hors gateway/delivery par AT-6/7 — aucun présent).

## 4. Database Schema (migrations 0001–0003)

```
plans(id PK, limits jsonb)                                   -- global, plan limits as data
users(id, email citext UQ, auth_provider, locale, deleted_at)-- global identity
workspaces(id, name, region, plan_id FK, deleted_at)          -- tenant root      [RLS+FORCE]
memberships(workspace_id, user_id, role, PK(ws,user))         --                  [RLS+FORCE]
connections(id, workspace_id, provider, status, scopes[],     -- ADR-019          [RLS+FORCE]
            capabilities jsonb, authorized_by NOT NULL, …)
provider_tokens(connection_id PK, enc_access_token, key_id,…) -- vault (I8)       [RLS+FORCE, app: ZERO grant]
config_overrides(id, key, value, workspace_id NULL, changed_by,
            reason, shadow_eval_ref, changed_at)              -- ADR-046 ledger   [RLS+FORCE, append-only BY GRANT]
audit_log(id, workspace_id NULL, actor, event, details, at)   -- append-only      [RLS+FORCE]
scheduled_jobs(id, workspace_id NULL, job_family, schedule,
            params, enabled, …)                               -- ADR-003          [RLS+FORCE]
magic_link_tokens(id, email, token_hash UQ, ua_family,
            expires_at, consumed_at)                          -- ADR-016, hashed at rest
sessions(id PK=cookie, user_id, refresh_family, refresh_hash,
            rotated_at, expires_at, refresh_expires_at,
            revoked_at)                                       -- ADR-017, rotation + family revoke
_migrations(name PK, applied_at)                              -- applier ledger
```

**Rôles** : `aigos_app` (NOBYPASSRLS, zéro accès provider_tokens) · `aigos_vault` (tokens uniquement, RLS-scopé, pas de DELETE — runbook R4). Scoping : `SET LOCAL app.workspace_id` par transaction (`set_config(...,true)`), pooler-safe ; `SET SESSION` banni par test.

## 5. Architecture Diagram (Phase 0 réel)

```
                    ┌─────────────┐        ┌──────────────┐
   HTTP ───────────▶│  apps/api   │        │ apps/worker  │◀─── tick (cron)
                    │  /health    │        │ scheduler +  │
                    └──────┬──────┘        │ canary stub  │
                           │               └──────┬───────┘
        ┌──────────────────┼──────────────────────┼─────────────────┐
        ▼                  ▼                      ▼                 ▼
┌───────────────┐  ┌───────────────┐   ┌─────────────────┐  ┌─────────────┐
│   identity    │  │   delivery    │   │      infra      │  │ ai-gateway  │
│ magic links + │─▶│ I7: SEUL      │   │ queue (ADR-003) │  │ I6: SEUL    │
│ sessions      │  │ envoyeur      │   │ cache · raw S3  │  │ chemin LLM  │
│ (ADR-016/017) │  │ (ADR-014)     │   │ observabilité   │  │ (shell)     │
└───────┬───────┘  └───────────────┘   └─────────────────┘  └──────┬──────┘
        │                                                          │
        ▼                  ┌───────────────────┐                   ▼
┌───────────────┐          │  config-registry  │◀──────── budgets/tunables
│   database    │◀────────▶│  ADR-046 + AT-14  │
│ RLS · vault · │          └───────────────────┘
│ migrations    │          domain (types purs) · adapters (Phase 1)
└───────────────┘
```

## 6. Package Dependency Graph (interne, appliqué par AT-boundaries)

```
api      ──▶ infra
worker   ──▶ infra, database          (+ cron-parser)
identity ──▶ delivery                 (+ pg)
database ──▶ config-registry          (+ pg, prisma)
ai-gateway ─▶ infra
delivery ──▶ (aucune)
config-registry ─▶ (aucune)
infra    ──▶ (bullmq)
domain   ──▶ (aucune — framework-free, testé par AT-boundaries)
adapters ──▶ (vide)
Interdits appliqués : packages ↛ apps · domain ↛ tout module · SDK modèle → ai-gateway seul · SDK envoi → delivery seul · pas d'imports profonds · pas de cycles.
```

## 7. Implemented ADRs (Phase 0)

| ADR | Implémentation |
|---|---|
| 001 | Monorepo TS modulaire, boundaries lintées (étape 1) |
| 002 | PostgreSQL ; pgvector différé au déploiement (voir dette) |
| 003 | BullMQ + scheduler Postgres-driven, jobs idempotents, DLQ |
| 014 | Budgets de notification + suppression ledgerée |
| 016/017 | Passwordless magic-link + sessions serveur rotatives |
| 019 | Connections workspace-owned, `authorized_by NOT NULL` |
| 043 | Migrations expand-contract + NOTES + gate CI |
| 044 | `prompt_template_version` dans chaque trace gateway |
| 045 | Gate shadow-eval : runtime (registry) + CI (diff) |
| 046 | Config-as-data, stabilité experiment→stable→frozen |
| 047 | SLO-as-data avec owners, états ok/degraded/breach/unknown |
| Partiels | 009/011 (tiers = types gateway), 007/021 (capabilities jsonb, contrat adapter Phase 1) |

## 8. Verified Invariants (preuves par violation réelle — `scripts/proofs/`)

| Invariant | Preuve |
|---|---|
| I4 | Tripwire : premier fichier de rendu sans garde évidence → build rouge (vacuité Phase 0 documentée) |
| I5 | UPDATE/DELETE sur ledgers append-only → `permission denied` (GRANT) |
| I6 | `import "openai"` hors gateway → build rouge nommant `AT-6-single-llm-path` |
| I7 | `nodemailer` hors delivery → `AT-7-single-send-path` |
| I8 | SELECT `provider_tokens` (rôle app) → `permission denied` + scrubbing logger testé |
| I9 | INSERT forgé cross-ws → RLS ; lecture croisée → 0 ligne ; sans contexte → 0 ligne |
| I14/AT-14 | Diff de poids sans artefact → bloqué (ADR-045) ; override runtime sans ref → refusé |
| I1–I3, I10–I13 | Surfaces Phase 1 (feed, scoring, side-effects, rapports) — gates prêts (déterminisme : snapshots config hashés déjà en place) |

## 9. CI/CD Workflow

`ci.yml` — deux jobs, tous required checks (merge bloqué si rouge) :

1. **gates** : `npm run typecheck` → `npm run test:arch` (AT statiques) → `npm test` (114 tests, Postgres réel embarqué) → `node scripts/gates/run.mjs <base>` (migrations ADR-043 · unscoped · decision-config AT-14).
2. **redis-integration** : service Redis 7 réel pour le driver BullMQ (report sandbox étape 4).

Cœur provider-agnostic : chaque gate est un script npm ; le YAML est un wrapper mince.

## 10. Remaining TODOs (entrées Phase 1 incluses)

1. **ADR outillage/déploiement** : consigner Supabase/RLS + TypeScript 5 (pas 7, incompatible dependency-cruiser) via DECISION_LIFECYCLE.
2. **AT-9 contre le vrai pooler Supabase** (transaction-mode) — suite prête, env réel requis.
3. **Driver S3 réel** (port `RawStore` prêt) + provisioning secrets/roles Supabase.
4. **pgvector** : extension au déploiement (KB embeddings, Phase 1+).
5. **Paperwork parallèle** (S20 Phase 0) : vérification Google OAuth, LinkedIn app review — côté fondateur, non-code.
6. **Canary spine complet** (gate de sortie S20) : fixtures signaux → règles → action → feed → outcome mock — dépend des premières briques Phase 1.

## 11. Technical Debt (faible, listée honnêtement)

- Étape 4 : intégration BullMQ/Redis non exécutée en sandbox (job CI prêt, non encore exécuté sur un runner réel).
- Delivery : état des gardes (budget/dedupe/cooldown) en mémoire — sémantique fixée par tests ; bascule derrière Cache/DB quand le digest arrive (Phase 1), sans changement de contrat.
- Prisma présent pour schéma+deploy mais repositories en `pg` brut — deux visions du schéma à garder synchrones (mitigé : SQL = source unique, schema.prisma miroir documenté).
- Rate-limit magic-link par fenêtre glissante SQL — suffisant mono-région ; revoir si multi-région.
- `sessions.validate` ne prolonge pas l'accès (pas de sliding window) — choix conservateur à confirmer en UX Phase 1.

## 12. Phase 1 Entry Points

| Brique Phase 1 (S20) | Point d'entrée existant |
|---|---|
| Adapters GSC/GA4/ForgCV | `packages/adapters` + `capabilities` jsonb + `RawStore` (raw-first) + queue |
| Signals & normalisation | migration expand (S3 §4) + worker job families |
| Onboarding + auth UI | `MagicLinkService`/`SessionService` + routes `apps/api` |
| Recommendation Engine | `config-registry` (poids S16 §7 prêts à définir) + snapshots hashés (I1) |
| Drafts (tier 3/4) | `AIGateway.infer` — brancher un `ModelProvider` réel DANS le package (AT-6) |
| Digest quotidien | `Delivery` + type `daily_digest` déjà enregistrable + scheduler |
| Ledger LLM | port `CostMeter` → table `llm_calls` (S3 §9, migration expand) |
| Evidence Generator (ADR-035) | tripwire I4 force la garde dès le premier composant de rendu |

---

*Rapport généré en fin de Phase 0. Aucune modification de code source. Le référentiel `/docs` reste la source de vérité ; ce rapport est descriptif, non normatif.*
