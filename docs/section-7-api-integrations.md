# AI Growth OS — Section 7: API Integrations

**Status:** Proposed v1 — pending founder review
**Depends on:** ADR-007 (capabilities-as-data), ADR-019 (workspace-owned connections, `authorized_by`), Section 2 §10 (adapter interface, raw-first), plan limits (Section 3/6)
**Framing:** every provider below is scored on **(signal value ÷ API risk)** as promised in Section 2. API risk = restrictiveness × revocability × cost volatility. This section decides what the product can truthfully promise — it is a business document wearing a technical costume.

---

## 0. The Adapter Contract (one framework, N providers)

Every provider implements the Section 2 interface; this section adds the operational contract all adapters must satisfy before shipping:

1. **Capabilities manifest** (ADR-007): machine-readable truth of what this connection can do — pipelines and UI copy both render from it. No adapter ships whose manifest overpromises.
2. **Quota citizenship:** all calls pass through the shared per-provider token bucket (Redis) with two layers — app-global quota and per-workspace fairness share. An adapter cannot starve the fleet.
3. **Raw-first, versioned normalizer**, idempotent ingestion via `dedupe_hash` (Section 3 §4).
4. **Recorded-fixture test suite:** every adapter carries recorded real responses (sanitized) as golden files; CI replays them through the normalizer. Provider sandboxes are unreliable or absent (LinkedIn, GSC) — our fixtures are the sandbox.
5. **Deprecation watch:** each adapter declares its API version + a `deprecation_check` job (polls provider changelog/headers where available); failures raise an ops alert, not a user-facing surprise.
6. **Failure honesty:** connection errors classify into `transient | quota | auth | capability_revoked` — the last two generate prerequisite Actions (per ADR-019 reauth semantics), never silent data gaps. A gap in signals is annotated in evidence ("no data June 3–5, connection expired") so the intelligence layer never confuses absence of data with absence of activity.

---

## 1. Provider Dossiers (ranked by signal value ÷ risk)

### 1.1 Google Search Console — **launch, the backbone**
- **Access:** Search Analytics API, free. OAuth scope `webmasters.readonly`.
- **Signal value: maximal.** Queries×pages×CTR×position, 16 months of backfill — powers the SEO pipeline, Audience Intelligence (query mining), and onboarding's first-run moment (ADR-015).
- **Constraints to design around:** data lags ~2 days (never promise "today's SEO"); rows are sampled/truncated for long-tail queries (evidence copy says "at least N impressions"); quotas generous but real (per-site and per-project QPS) — backfill jobs chunk by date ranges with backoff.
- **Risk: low.** Stable API, a decade of history, free. Deprecation risk mainly = Google account security posture changes (verification requirements for OAuth apps — see §3, our app verification is a launch-blocking admin task, lead time weeks).

### 1.2 GA4 Data API — **launch**
- **Access:** free; token-based quota system (property tokens/hour/day — a real budget, not vibes).
- **Signal value: high** — sessions, sources, landing performance, conversions where configured. Conversion pipeline's second leg.
- **Constraints:** quota tokens vary by query complexity → adapter maintains a **query cost ledger** and prefers daily scheduled aggregate pulls over ad-hoc exploration (which our no-Analytics-tab UX conveniently never needs); thresholding can hide small-segment rows (annotate evidence); GA4 configuration quality varies wildly per user → adapter ships a `setup_quality` check that becomes prerequisite Actions ("define signup as a key event — unlocks conversion insights").
- **Risk: low-medium** (Google deprecated UA once; assume GA4 API evolves — versioned normalizer earns its keep here).

### 1.3 ForgCV internal (`forgcv.internal`) — **launch, zero risk**
- Our API, our contract. **This section formalizes the event schema** so ForgCV's team (us) treats it as a real integration:
  `visit / signup / activation / feature_used / subscription / referral` with `{ts, anon_or_user_id (pseudonymous), source, utm_*, page, meta}` — pushed via signed webhook to the Growth OS ingestion endpoint + daily reconciliation pull.
- Privacy note (GDPR): events arrive pseudonymized; the Growth OS needs funnels, not identities. Data minimization at the contract level, not as an afterthought.
- **Risk: none external — but one internal:** convenience will tempt shortcuts ("just query ForgCV's DB"). Forbidden; the adapter boundary is the no-`if (forgcv)` rule made operational.

### 1.4 LinkedIn — **launch, narrow and honest (the dossier that earns this section)**
- **What the API actually grants a standard app in 2026:** Sign-In (identity), and Share/Post on behalf of the authenticated member (`w_member_social`). **Member post *analytics* are effectively not available** to standard apps; richer read access (organization page analytics via Community Management API) requires LinkedIn partner-program approval — months of lead time, uncertain outcome, and mostly scoped to *company pages*, not member profiles.
- **Consequences, built into the launch design:**
  - Publish-assist via API where the user opts in (posting under their identity, always explicit — ADR-019's `authorized_by` shown in UI), else draft-and-deep-link. Both paths exist; the capabilities manifest decides.
  - **Performance measurement does not depend on LinkedIn** — see ADR-020 below: every draft carries UTM-tagged links, so GA4/ForgCV referral data measures what LinkedIn won't tell us (clicks, signups per post). Impressions/reactions we can't read via API arrive via an optional 10-second manual entry on the post's outcome card ("paste your numbers") — imperfect, honest, and enough for the format-learning loop (n counts anyway).
  - **Company page path:** ForgCV has a LinkedIn org page; we apply to the Community Management API partner program **now** (lead-time hedge) — if granted, org-page analytics become a capabilities upgrade, zero architecture change.
- **Risk: high and priced in.** LinkedIn revokes API access aggressively; the design above degrades to draft-and-deep-link + UTM measurement, which loses convenience but no core value. That degradation path is the whole point of ADR-007.

### 1.5 Hacker News — **phase 2, possibly early (cheapest win in the roster)**
- **Access:** Algolia HN Search API + Firebase API — free, no auth, generous, stable for a decade.
- **Signal value: medium-high for our persona** (career/dev/startup discussions; Show HN launch monitoring). Community pipeline's lowest-risk feed and a fine rehearsal for Reddit's harder etiquette problem.
- **Risk: minimal.** Honestly, if phase 2 needs a pilot provider, it's this one.

### 1.6 Reddit — **phase 2, the community pipeline's main course**
- **Access:** OAuth API, free tier ~100 QPM per app — workable for watchlist polling at our per-plan frequencies; commercial terms above that. **Post-2023 Reddit treats API access as a revenue line: pricing/policy volatility is the top risk**, priced into plan gating (community monitoring = paid plans).
- **Constraints as design inputs:** strict per-app rate limits → watchlist polling budgeted per workspace (e.g., 5 subreddits × 4 pulls/day on Growth); ToS forbids circumvention and the *culture* forbids much more — the community-culture KB metadata (risk_level, promotion_policy) from your Section 4/5 decision is the real compliance layer; drafts disclose affiliation where subreddit norms expect it, enforced as tier-0 rules.
- **Risk: medium-high (commercial), mitigated by:** modest volume, official API only, degradation path = reduce polling frequency before dropping the feature.

### 1.7 Product Hunt — **phase 2**
- **Access:** GraphQL API, free with rate limits. Launch/category monitoring + comment signals. Low risk, modest value outside launch windows — but *very* high value during ForgCV's own launches, which is a nice dogfooding moment.

### 1.8 SERP data provider — **phase 2, the only paid ingestion source**
- **Access:** commercial API (DataForSEO-class; provider chosen behind the adapter, swappable by design — this market has interchangeable vendors, which is our leverage). Cost ≈ €0.002–0.01 per keyword-check; at plan caps (0/10/50/250 tracked keywords, weekly checks) → ≈ €0 / €0.04–0.4 / €0.2–2 / €1–10 per workspace/month. Enters unit economics per your standing rule; Growth plan margin holds comfortably.
- **Legal note:** we buy SERP data from a provider rather than scraping — the provider carries the collection method risk. That's part of what the fee purchases, and it's the compliant posture consistent with Section 4 §6's boundary.
- **Risk: low-medium** (vendor swap is cheap; cost scales linearly and visibly with a plan-capped number).

### Explicitly not integrated (standing register, with reasons)
X/Twitter (API pricing hostile to our unit economics at launch; revisit annually) · Instagram/Meta (no meaningful read access for our use case without business-asset complexity disproportionate to persona value) · Google Business Profile, YouTube, TikTok, newsletters (ESPs) — each parked with a trigger condition in the Architecture Review, so "no" stays a decision, not a blind spot.

---

## 2. ADR-020 — Measurement Independence (UTM discipline)

**Every piece of content the system drafts embeds UTM-tagged links (`utm_source/medium/campaign/content` with a per-action content ID).** Outcome evaluation for social/community actions reads GA4 + ForgCV referral signals keyed on those UTMs — meaning **the closed loop works even where platform APIs give us nothing back** (LinkedIn today, any future platform tomorrow).

- Trade-off: UTM links measure *clicks-through*, not impressions/engagement — the manual-entry card covers the gap where the user cares.
- This ADR quietly de-risks the whole roadmap: platform read-APIs become *enhancements* to measurement rather than prerequisites for it. Our learning loop's floor is set by Google + ForgCV data we fully control.

## 3. Operational Register (launch-blocking admin tasks with lead times)

| Task | Lead time | Blocks |
|---|---|---|
| Google OAuth app verification (GSC+GA4 scopes) | 2–6 weeks | Launch |
| LinkedIn app review (Sign-In + w_member_social) | 1–4 weeks | Launch |
| LinkedIn Community Mgmt partner application | months, uncertain | Nothing (upgrade path) |
| SERP vendor contract + DPA | 1–2 weeks | Phase 2 |
| Reddit app registration + ToS review | 1 week | Phase 2 |
| Sub-processor list update (privacy policy) | with each vendor | Compliance |

These enter the project plan now — API paperwork is the classic silent launch-slipper.

## 4. Architecture Review Delta (v0.7)

**New ADRs:** ADR-019 (workspace-owned connections + `authorized_by` + reauth semantics — founder decision, refined) · ADR-020 (UTM measurement independence) · ADR-021 (adapter operational contract: quota citizenship, fixtures-as-sandbox, deprecation watch, failure honesty).
**Risk updates:** R1 substantially restructured — LinkedIn read-limitation now *designed around* (ADR-020 + manual entry + partner application in flight) rather than merely feared; R20 (new): Google OAuth verification delay → start immediately; R21 (new): Reddit commercial-terms volatility → plan-gated, degradation path defined.
**Open questions for founder:**
1. LinkedIn publish-via-API vs draft-and-deep-link as the *default* for opted-in users? My recommendation: **deep-link default, API-publish as explicit per-post choice** — publishing under the user's identity should feel like their hand on the button, and it sidesteps the "the tool posted for me" trust cliff entirely at launch.
2. Manual-entry card for LinkedIn post stats: keep (my recommendation — cheap, honest, feeds format learning) or drop as friction?
3. Approve starting the LinkedIn partner application and Google verification paperwork now, ahead of code.
