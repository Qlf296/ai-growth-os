# AI Growth OS — Section 10: SEO Intelligence

**Status:** Proposed v1 — pending founder review
**Depends on:** Section 4 §2 (SEO pipeline — the owner of processing), Section 8 (shared baselines w/ maturity, event register, ADR-025), Section 3 (ADR-008 criteria), founder scope directive for this section
**Scope, honoring the directive:** this section does not recreate Growth Intelligence, scoring, or the Action Engine. It specifies exactly one thing: the **detector library** — how raw GSC/GA4 signals become SEO opportunity candidates. Flow stays: `GSC → SEO Intelligence (detectors) → candidates → Action Engine → Today`. Everything here is configuration and queries for the pipeline Section 4 already owns.

**The organizing question (founder's):** *how would an experienced SEO expert find today's 3 best actions without spending 3 hours in Search Console?* Answer: experts don't explore — they run reflexes. Each detector below is one such reflex, made deterministic, evidence-bearing, and cheap.

---

## 0. Detector Contract

Every detector is a named, versioned unit obeying one contract:

```
detector(workspace) →  candidates[]: {
  page/query target, evidence[] (signal refs, baseline comparisons),
  proposed action template, effort estimate,
  success_criteria (ADR-008 structured, auto-evaluable),
  detector_version
}
```

Rules all detectors share: thresholds are **rules-as-data** (D6) with per-workspace overrides · baselines come **only** from the shared service (ADR-022 — no private "normal") · maturity gating applies (immature baseline → detector abstains or labels) · every candidate must survive "pourquoi crois-tu ça ?" with rows (ADR-025) · **one page = one action** (see ADR-031 below) · detectors emit candidates, never urgency (Section 8 rule extends: only D5's acute subset may use the urgent-interrupt lane, and only via ADR-014's rule gate).

## 1. The Detector Catalog

### D1 — Striking Distance (launch, tier 0–1)
- **Reflex encoded:** "what's on page 2 that deserves page 1?"
- **Rule:** avg position 8–20 over 28d ∧ impressions ≥ floor (default 100/28d, plan-tunable) ∧ page not already targeted by an open Action.
- **Emits:** content-upgrade candidate; evidence = query set, position trend, impression volume; criteria = position ≤ target ∧ clicks ≥ +X% @ 28–56d window (position moves slower than CTR — window per action type, rules-as-data).

### D2 — CTR Gap (launch, tier 0–1) — with the section's most important honesty decision
- **Reflex:** "which pages get seen but not clicked?"
- **ADR-030 — expected CTR comes from the workspace's own position-CTR curve**, computed from its GSC data (median CTR per position bucket, maturity-gated), *not* from published industry curves. Global CTR-by-position tables are averages over sites unlike yours (brand vs non-brand, SERP features, verticals) and are the single most common source of fake-precision SEO advice. Before curve maturity: global curve from `benchmark_sources`, labeled `observation`, wide bands only.
- **Rule:** page-query CTR < own-curve expectation − k·MAD ∧ impressions ≥ floor. Brand queries excluded (rule-detected via domain-token match — CTR on your own name is not an opportunity).
- **Emits:** title/meta rewrite candidate (tier-4 variants on accept, ADR-011); criteria = CTR ≥ curve expectation @ 28d — the fastest-verifying loop in the whole product, which is why Section 5 uses it as the canonical example.

### D3 — Cannibalization (launch, tier 1–2)
- **Reflex:** "are two of my pages fighting for one query?"
- **Rule:** ≥2 pages receiving impressions on the same query cluster ∧ position volatility high (URL-flapping in GSC) ∧ combined performance below what the better page alone achieves on its stable queries.
- **Emits:** consolidate/differentiate candidate (merge, canonical, or re-target — template chosen by rule on page ages and traffic split); criteria = single-URL stability + cluster clicks @ 56d. Confidence honest: cannibalization diagnosis is inference — labeled `suspected`, per the metric/interpretation split.

### D4 — Content Decay (launch, tier 0–1)
- **Reflex:** "what used to earn and is quietly dying?"
- **Rule:** page clicks `degrading` per shared changepoint service ∧ decline not explained by seasonal adjustment ∧ **no co-occurring Google update in the event register** (see §3 quiet period) ∧ page previously mature (had a real baseline — new pages can't "decay").
- **Emits:** refresh candidate with the decay evidence and the queries losing share; criteria = clicks return to ≥ X% of prior baseline @ 56d.

### D5 — Technical Signals (launch, tier 0)
- **Reflex:** "is anything structurally broken?"
- **Sources:** GSC index coverage + sitemaps API. Rules: coverage-state transitions (indexed→excluded deltas beyond noise), sitemap fetch errors, sudden indexed-page-count drops.
- **Acute subset (the only urgency in this section):** site-level deindexation pattern, robots/noindex catastrophe signatures → ADR-014 urgent-interrupt lane. Everything else is ordinary candidates.
- Criteria = coverage state restored @ 14d. Effort estimates honest: many fixes are `required_user_skill: developer` — the effort-fit term (arbitration) and skill gate already handle routing.

### D6 — Internal Linking (launch-lite; full in Phase 2)
- **Reflex:** "which strong pages should pass authority to which striking-distance pages?"
- **Launch-lite (no crawler):** GSC-only heuristic — pages strong on a topic cluster (top clicks) paired with striking-distance pages in the same cluster (D1 × D7 join) → "link from A to B" candidates with anchor suggestions from the query set. Labeled `heuristic` honestly: without crawling we don't know whether the link already exists, so the action template says "check & add."
- **Phase 2 — ADR-032, own-site crawler:** a polite, consented crawler of the *user's own site* (sitemap-driven, robots-respecting, low frequency, EU-hosted) upgrades D6 to real link-graph analysis and adds on-page checks (titles/H1s/meta presence) as new signal types. Consent captured at connection ("we crawl your site to analyze internal structure — never anyone else's"). Own-site crawling carries none of Section 4 §6's competitor-crawl legal weight; the boundary between the two stays explicit.

### D7 — Query Intent Clustering (launch, tier 2–3, weekly)
- **Reflex:** "what is my audience actually asking?"
- **Mechanics:** embed GSC queries (tier 2), cluster, label clusters (tier 3, one small-model batch weekly), classify intent (informational/comparison/transactional — small model, controlled labels like ADR-026's taxonomy).
- **Dual consumer, single computation:** feeds D1/D2/D6 grouping *and* the Audience Intelligence pipeline (Section 4's founder addition — "users searching 'CV without experience' have high intent but no landing page answers it" is exactly a cluster-with-no-matching-page finding). Content-gap candidates emit from clusters with impressions but no owned ranking page.

### D8 — SERP Competitor Overlap (Phase 2, plan-gated)
- Per the Section 4 §6 boundary and Section 7 §1.8 vendor: for tracked keywords (plan caps 0/10/50/250), "who outranks you where you're striking-distance," converting directly into D1-enriched candidates ("competitor page covers X and Y sections yours lacks" — tier-3 diff summary of the two pages, both fetched legitimately: theirs is public content read once for analysis, ours via crawler/user). No traffic estimation, no site-wide competitor crawling — the boundary holds.

## 2. Composition — the "expert's morning" (why the feed gets 3 good ones, not 30 nags)

The pipeline's assembly step (Section 4 framework, configured here):

1. Run detectors on schedule (daily D2/D4/D5; weekly D1/D3/D6/D7 — matching how fast each underlying signal actually moves; GSC's ~2-day lag is respected in all windows).
2. **Group by page (ADR-031):** all findings on one URL merge into one candidate carrying the union of evidence ("this page is striking-distance AND has a CTR gap" is one strong action, not two weak ones). This grouping is what separates an expert's judgment from a tool's checklist — and it's a deterministic merge rule, not a model call.
3. Dedupe against open/recent Actions (Section 3 keys), apply detector-level track record (detectors whose completed actions keep missing criteria lose share — same mechanism as pipelines, one level down).
4. Hand at most 3 SEO candidates/day to arbitration (founder-ratified pipeline cap). The global feed cap of 3 total actions/day (D7) remains the Action Engine's — per-pipeline caps bound supply, never guarantee slots. The rest wait: SEO opportunities are rarely perishable, and feed trust is (R6).

## 3. Honesty Rules (SEO edition, binding)

- **Google-update quiet period:** within 7 days after a core-update date (event register, curated), D4 suppresses decay candidates and anomaly copy says "co-occurs with Google update — recommend observing before acting." Knowing when *not* to act, as you put it — this is that, for SEO.
- **No traffic predictions.** Impact stays tiered; the only numbers shown are measured ones (D2's criteria verify against the workspace's own curve).
- **No "SEO score."** Composite site scores are dashboard theater; we have detectors, evidence, and outcomes.
- GSC sampling/threshold caveats surface in evidence copy ("at least N impressions") — established in Section 7, enforced in templates here.

## 4. Cost & Cadence Summary

| Detector | Cadence | Tier | LLM €/ws/mo |
|---|---|---|---|
| D1, D3, D4, D5 | daily/weekly | 0–1 | 0 |
| D2 (+ own curve) | daily | 0–1 | 0 (variants on-accept: ~0.01) |
| D6 lite | weekly | 1 | 0 |
| D7 clustering | weekly | 2–3 | 0.02–0.04 |
| D8 (Phase 2) | weekly | 1 + tier-3 diffs | 0.03 + SERP vendor |

**Launch total: ~€0.03–0.06/ws/mo** — inside every ceiling set so far. The expert's morning costs less than a coffee bean.

## 5. Architecture Review Delta (v0.10)

**New ADRs:** ADR-030 (per-workspace position-CTR curve; global curves only as labeled fallback) · ADR-031 (page-level candidate grouping — one URL, one action) · ADR-032 (Phase-2 consented own-site crawler; explicitly distinct from the competitor-crawl boundary).
**New risks:** R26 — JS-heavy/SPA sites make Phase-2 crawler and on-page checks unreliable → sitemap+GSC degradation path, honest capability labeling per site · R27 — GSC API sampling underrepresents long-tail for large sites → floors + "at least" copy; revisit if Agency-tier sites hit it.
**Open questions for founder:**
1. Own-site crawler timing: strict Phase 2 (my recommendation — D6-lite carries launch) or pulled forward if ForgCV's own internal-linking needs justify it as dogfooding?
2. CMS write-integrations (WordPress et al.) for one-click title/meta application: park with a trigger (repeated user requests), or pre-commit to Phase 3? My recommendation: park — deep links + copy-paste keep the human hand and zero integration surface for now.
3. ~~Default candidates/day~~ — resolved by founder: 3 SEO candidates/day max into arbitration; global Today cap stays 3 total.
