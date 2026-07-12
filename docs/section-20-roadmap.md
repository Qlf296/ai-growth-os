# AI Growth OS — Section 20: Development Roadmap

**Status:** Proposed v1 — pending founder review
**Nature:** synthesis. Every item below was decided and scoped in Sections 1–19; this section orders them in time and defines the gates between phases. Gates are **evidence criteria, not dates** — the same epistemology the product applies to its users, applied to building it.

---

## Phase 0 — Foundations (build-first, ~the unavoidable substrate)
Monorepo + module boundaries (ADR-001) · Postgres/Redis/S3 + core schema w/ RLS (S3) · queue + scheduler (ADR-003) · IaC, CI/CD, staging (ADR-005) · observability skeleton + error tracking (ADR-047 minimal) · config registry (ADR-046 — early, because everything else stores its tunables there) · **paperwork in parallel from day 1:** Google OAuth verification, LinkedIn app review (S7 §3 — the silent launch-slippers).
**Gate → Phase 1:** synthetic canary workspace runs the full spine (fixture signals → rules → action → feed → mock outcome) green for a week; leak-test suite green; restore drill #1 passed.

## Phase 1 — MVP (the honest core: "GSC in, trusted actions out")
Auth (ADR-016/017) + onboarding incl. strategy interview (ADR-015) · adapters: **GSC, GA4, ForgCV** (S7) · SEO detectors D1–D5 + D7 (S10) · Conversion pipeline · Social (LinkedIn draft+deep-link, Voice Profile v1, taxonomy) · Content-lite · Experiment Engine minimal · Growth Intelligence (baselines, Growth Model, bottleneck w/ abstention) · Recommendation Engine complete (S16 — it's the product; it ships whole) · Analytics Engine (verdicts, grades, propagator) · Today/Experiments/Learnings/Settings (S5) · digest + notification registry (S13) · GDPR export/deletion · Free + Growth plans (Creator can follow; two plans validate the gradient first).
**Primary internal user: ForgCV (P7).** The MVP is done when it runs ForgCV's growth for real.
**Gate → Phase 2 (evidence, not vibes):** ≥6 weeks of ForgCV dogfooding + first external cohort · ≥60% weekly action-completion among actives · first grade-A `met` outcomes reported back · dismissal rate <40% with reasons flowing · COGS within S19 §5 · zero cross-tenant or token incidents · pentest passed (S18 gate).

## Phase 2 — Widening the loop (opportunity discovery + convenience)
Reddit + HN adapters, Community pipeline + playbooks + reputation (S4/S9) · SERP vendor + D8 + Competitor Intelligence C1–C3 (S12) · A2 confirmed-scheduled publishing w/ LinkedIn API opt-in (ADR-048) · own-site crawler + D6-full (ADR-032) · Content Strategist full · Audience Intelligence full (support/survey sources) · PWA push (engagement-gated, S13) · Creator + Agency plans, multi-workspace UX surfaced · monthly report share links (S17).
**Gate → Phase 3:** community actions show positive graded outcomes without reputation incidents · Agency-tier demand real (pull, not push) · shadow-eval cadence routine · k≥25 aggregate pool forming.

## Phase 3 — Compounding intelligence (only what the data has earned)
Cross-workspace observations live in feeds (ADR-012 policy) · tier-4 daily synthesis **if** it beats deterministic assembly in acceptance (the deferred Growth Coach finally auditions — against a measured bar, S4 §10) · weight/threshold auto-tuning proposals via shadow-eval pipelines (human-ratified — Law 16 applies to us too) · invitations + Model B team UI when triggered (ADR-018) · TOTP · X/Meta reconsidered on their annual review triggers · CMS write-integration if its trigger fires (S10) · WORM audit upgrade on enterprise demand.

## Deferred/Refused Register (decisions, not omissions)
Analytics tab — **refused permanently** · streaks/gamification — refused (Constitution) · A3/A4 automation — forbidden (ADR-048) · euro-ROI before revenue events — refused (Law 15) · traffic estimates (ours or competitors') — refused · microservices/K8s/Kafka/multi-region — trigger-gated (S19 §3) · fine-tuned voice models — refused (ADR-027) · investor report template — deferred to observed behavior.

## 12–24 Month Vision (the compounding thesis)
Year 1 proves the loop on ForgCV + early cohort: *signals → actions → measured outcomes → knowledge that changes next month's actions.* Year 2 compounds it: the KB deepens per workspace, the commons crosses k-thresholds, detector health prunes what doesn't work (ADR-040 retires features honestly), and the product's moat is exactly the thing competitors can't copy by shipping features: **a trustworthy track record per user.** The endgame restates Section 1 correctly: not "the most AI," but the system a founder checks every morning because it has *earned* the first ten minutes of their day.

**Open questions — resolved by founder:** gate criteria ratified (≥60% completion, <40% dismissal) ✓ · Creator in Phase 2 ✓ · Deferred/Refused register frozen into v2.0 ("almost as important as the roadmap — it prevents settled decisions from endlessly returning to discussion") ✓.
