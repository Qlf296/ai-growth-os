# AI Growth OS — Section 17: Reporting & KPI System

**Status:** Proposed v1 — pending founder review
**Consumes (as predicted):** ADR-033 (grades), ADR-034 (honest ROI), ADR-035 (Evidence Generator — every factual sentence below is rendered by it), ADR-044 (traces), Section 8 (Growth Model, focus history), Section 11 (verdicts), Constitution Laws 7–10, 15.
**The reconciliation, first:** the founder's plan says "dashboards"; the referential ratified *No Analytics tab*. These are compatible once named precisely — **reporting here is moments and documents, never destinations.** A report is generated, read, acted on, and closed. Nothing in this section creates a screen the user is meant to stare at daily; the daily surface remains Today. Where a stakeholder needs numbers, we generate them a document — we don't build them a room.

---

## 1. Report Taxonomy (two exist, two are new assemblies)

| Report | Cadence | Status | Contents |
|---|---|---|---|
| Daily digest | daily | exists (S13) | the day's actions + yesterday's report-backs |
| Weekly review | Friday | exists (S5/S8) | shipped, one landed outcome, next week's focus, ≤1 strategy suggestion |
| **Monthly Growth Report** | monthly | **new assembly** | §2 — the flagship document |
| Experiment report | on completion | exists (S4/S11) | hypothesis, verdict, evidence strength, learning created |

**Monthly Growth Report** — the document a founder forwards to a co-founder or investor, assembled entirely from existing stores: funnel state + trend (Growth Model snapshots, with `data_quality` labels rendered), the five Core Principle metrics (§3), actions completed with graded outcomes ("14 completed · 9 met target · 2 partial · 1 not met · 2 unmeasurable" — **misses always included**, §4), channel efficiency (measured units, ADR-034), learnings promoted this month (epistemic badges + n), focus history with overrides (the strategy narrative the `focus_change_reason` fields were quietly built for), and next month's detected constraint (or honest abstention). Optional tier-4 narrative introduction (~€0.02, template-framed, factual sentences still Evidence-Generator-rendered — the model narrates *around* the facts, per ADR-035).

## 2. Delivery & Sharing Mechanics

Generated as a job (deterministic assembly + `template_version` in the ledger, S13 pattern), rendered in-app and exportable to PDF (the pdf pipeline is a worker job; EU-processed), shareable via time-limited signed link (14 days, revocable, audit-logged — it may contain business data; it gets the export treatment from Section 6). Localized FR/EN. Recipients see a static document — **share links never grant workspace access**; they are snapshots, not windows.

## 3. The KPI Framework (five numbers, honestly dressed)

The Core Principle metrics, each sourced from the Growth Model and rendered identically everywhere:

| KPI | Source | Rendered with |
|---|---|---|
| Organic traffic | GSC/GA4 rollups | trend label (changepoint service), data_quality, evidence ref |
| Community growth | platform + UTM referral signals | capability-honest (what we can/can't measure per ADR-041 copy) |
| Conversion | ForgCV funnel | stage, baseline, maturity status |
| Brand authority | **proxy, labeled as proxy**: branded-query impressions (GSC) + referring engagement | the one KPI where honesty demands a modesty note — "authority" has no true meter; we show the proxies and say so |
| Revenue | ForgCV revenue events | absent until events flow — rendered as `not yet measured`, never estimated (Law 15) |

Rules: **no composite "growth score"** (Section 10's refusal, generalized — composites are dashboard theater); **targets are the user's, never ours** — the user may set a target per KPI (stored in Strategy Profile; reports then show progress-vs-*their*-goal); the system suggests realistic ranges only from the workspace's own trend, bands labeled. Trend arrows come from the shared changepoint service — one definition of "improving" across the entire product (ADR-022's law, applied to reporting).

## 4. Report Integrity (the section's one hard rule)

**Every report is reproducible from stored evidence** (founder amendment — the one-line bridge between ADR-035, ADR-044, and this section: a report is a deterministic render over ledgers, snapshots, and traces; regenerate it any day and the numbers match or the diff is explainable by data corrections, themselves audited). And: **a report is complete or it is not generated.** The founder chooses the period and may omit whole *sections* (an investor version without the learnings section is legitimate); but within any included section, numbers cannot be cherry-picked — track record always carries its misses and its `unmeasurable`, attribution grades render on every claimed win (grade-C wins say so, S11 founder decision), and every number carries its evidence reference (ADR-035, compile-enforced). The vanity-report pressure will come — from users, and someday from our own marketing. The refusal is pre-decided here, same pattern as the euro-ROI refusal: **the product's credibility is that its reports can be checked.** A Growth OS whose reports flatter is a Growth OS whose recommendations can't be trusted; the two die together.

## 5. Ops & Governance Reporting (internal, brief)

The system reports on itself with the same machinery: monthly D5 review (per-feature €/user from the LLM ledger), quarterly ADR-040 feature-kill review, ADR-042 detector/pipeline health digests, ADR-047 SLI summaries, config-change log (ADR-046 registry diffs with shadow-eval references). These are internal documents on the same Evidence-Generator rails — we drink the honesty we serve.

## 6. Delta

**No new ADRs, no new mechanisms** — two new report assemblies and one integrity rule filed under existing law. LLM cost: ~€0.02–0.04/ws/mo (optional monthly narrative; everything else deterministic).
**New risk R33:** shared-report data leakage (forwarded links) → time-limited signed URLs, revocation, no workspace access, audit log, and a visible "shared with link" register in Settings.
**Open questions — resolved by founder:** integrity rule ratified verbatim ("probably the most important rule in all of reporting") ✓ · monthly tier-4 narrative included at launch ✓ · investor template deferred — learn from observed sharing behavior first ✓.
