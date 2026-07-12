# AI Growth OS — Section 12: Competitor Intelligence

**Status:** Proposed v1 — pending founder review
**Depends on:** Section 4 §6 (the pre-drawn boundary), Section 7 §1.8 (SERP vendor, plan caps), Section 10 D8, ADR-024 (event register), Product Constitution (Laws 6–10, 15)
**The founder's question, answered as the section's spine:** *what can a founder legally learn from competitors without turning the product into a surveillance tool?* Answer: **only what competitors have chosen to say in public, read politely, dated, and attributed** — their search presence, their public pages, their public launches. Everything else is either illegal, ToS-violating, fabricated, or creepy — four flavors of the same mistake.

---

## 0. The Perimeter (binding, before any mechanics)

| Allowed (public, chosen speech) | Forbidden (surveillance & fabrication) |
|---|---|
| SERP positions on *our* tracked keywords (licensed vendor data) | Traffic/revenue estimates of any kind — **fabrication by construction** (Laws 9, 15 applied to third parties) |
| User-nominated public pages (pricing, changelog, blog), read politely | Anything behind auth walls, paywalls, or robots.txt disallow — no circumvention, ever |
| Public launch/discussion signals (Product Hunt, HN — official APIs) | Competitor social analytics (API-forbidden — same R1 reality, and we don't scrape around it: Law 15/16 platform laws) |
| Content-gap analysis of pages that *outrank us* (fetched once, analyzed, not stored as copies) | Monitoring competitor employees, founders' personal accounts, or hiring pages for "intelligence" — people aren't competitors; companies are |
| | Reverse-engineering competitor analytics, pixels, or A/B tests |

Two postures worth stating plainly: **(1)** we observe *companies' public statements*, never *people* — competitor page metadata may contain author names; we store facts about pages and companies, not profiles of humans (GDPR posture extends to third parties). **(2)** Competitor intelligence here is an **evidence enricher for existing pipelines**, not a rival feed — most of its output strengthens SEO/content candidates rather than creating a new action category. A product that makes founders stare at competitors daily has failed them; the design below is deliberately weekly, capped, and calm.

## 1. Schema

```sql
competitors (
  id, workspace_id, name, domain,
  nominated_by uuid, created_at,          -- ADR-036: user-nominated ONLY, never auto-discovered-and-added
  status text                              -- 'active' | 'paused'
)                                          -- cap: plans.limits.competitors (0 / 2 / 5 / 15)

competitor_watched_pages (
  id, competitor_id, url, page_kind text,  -- 'pricing' | 'changelog' | 'blog_index' | 'landing'
  robots_allowed bool, last_fetch_at, fetch_interval_days int,   -- default 7; never < 3
  content_hash text                        -- we store hashes + structured diffs, not page copies
)

competitor_observations (                  -- append-only, provenance-first (same discipline as benchmark_sources)
  id, workspace_id, competitor_id,
  kind text,        -- 'serp_position' | 'page_change' | 'launch' | 'content_gap'
  observed_at, source text, source_url,
  data jsonb,       -- structured facts: {keyword, position} | {change_summary, diff_kind} | ...
  confidence text
)
```

Auto-*suggestion* of competitors is allowed at onboarding ("these domains outrank you on 8 of your keywords — track them?"), but a competitor only exists after the founder's confirmation — ADR-036. The user curates their competitive set; the system never grows it silently.

## 2. Collectors (three, all narrow)

### C1 — SERP Overlap (Phase 2 with D8, plan-gated)
Weekly, via the licensed vendor (Section 7 §1.8 — the vendor carries collection-method risk; that's what the fee buys): for tracked keywords, who ranks above us. Emits observations that **enrich D1/D8 candidates**: "you're position 11; competitor X holds position 4 with a page covering sections yours lacks" — the gap analysis (tier-3 structural diff of the two pages: headings, topics covered, freshness; fetched once, summarized, source discarded) turns rivalry into a concrete content brief. No competitor keyword *discovery* beyond our tracked set at launch of this phase — expanding "what do they rank for that we don't" is a later, cost-reviewed addition (it multiplies SERP spend).

### C2 — Watched-Page Change Detection
**ADR-037 — the polite observation protocol, binding:** identified user-agent (`GrowthOS-PageWatch`, contact URL), robots.txt honored absolutely (disallowed → page unwatchable, UI says so), fetch interval ≥ 3 days (default 7), one URL per fetch, no crawling beyond nominated URLs, immediate backoff on 429/403, and **no stored page copies** — hash + structured diff summary only (copyright posture: we analyze, we never republish or archive). Changes classify at tier 0–1 (hash delta → section-level diff) with a tier-3 one-line summary on material changes: "Competitor X's pricing page: new tier added at €19." Feeds the **event register** (ADR-024) too — a competitor's pricing change is legitimate context for interpreting our own funnel shifts.

### C3 — Public Launch Monitoring (PH/HN, official APIs)
Competitor domain mentioned in a launch/discussion → observation + optionally one calm Action ("Competitor X launched on PH today — worth reading the comments for objection patterns" — which is Audience Intelligence wearing a competitor lens; the comments are *users' public objections*, the most legitimately valuable competitive signal that exists).

## 3. What It Produces (and refuses to)

- **Produces:** enriched SEO/content candidates (the main output), positioning-change awareness Actions (≤1/week in feed — arbitration's diversity rule already prevents competitor obsession), event-register context, and KB `competitor_fact` entries with full provenance + `observed_at` (facts age; a 9-month-old pricing observation renders with its date, per the provenance discipline).
- **Refuses, by construction:** competitor dashboards (no Analytics tab applies doubly here), traffic/revenue estimates (Law 15 extended: *no invented business value — including theirs*), "spy digest" emails, sentiment tracking of competitor founders, and any action framed as attack ("undercut their pricing") rather than improvement ("your pricing page lacks the annual-plan clarity theirs has"). Tone is enforced in templates: competitors are reference points, never enemies — founders don't need a product that cultivates their anxiety.

## 4. Legal & Compliance Notes (EU posture)

Reading public web pages politely and infrequently, honoring robots.txt, storing facts rather than copies, and buying SERP data from a licensed vendor is the defensible configuration under EU law and platform ToS — each element does real work: robots honor (ToS/trespass analogies), no stored copies (copyright/database rights), facts-not-profiles (GDPR), vendor-sourced SERP (their collection risk, their compliance problem). The moment any future feature proposal requires weakening one of these four, it comes back to you with this section attached.

## 5. Cost & Cadence

| Collector | Cadence | Cost/ws/mo |
|---|---|---|
| C1 SERP overlap + gap diffs | weekly | vendor (Section 7 caps) + ~€0.02–0.05 tier-3 |
| C2 page watch (≤5 pages × 4 competitors typical) | 7-day default | ~€0 fetch + ~€0.01 tier-3 summaries |
| C3 launches | daily poll (cheap APIs) | ~€0 |

Marginal LLM addition ≈ **€0.03–0.06/ws/mo**, Growth plan and above (Free/Creator: 0 competitors — consistent with SERP gating).

## 6. Architecture Review Delta (v0.12)

**New ADRs:** ADR-036 (competitors exist only by founder nomination/confirmation; plan-capped; system suggests, never adds) · ADR-037 (polite observation protocol: identified UA, robots absolute, ≥3-day intervals, hash+diff storage only, no copies) · ADR-038 (competitor knowledge is provenance-first, dated, fact-not-profile; no derived traffic/revenue estimates — Law 15 extended to third parties).
**New risks:** R29 — watched pages blocking our UA → honest degradation ("Competitor X blocks automated reading — we can't watch this page"), never circumvention · R30 — competitor-anxiety UX creep (future feature pressure for dashboards/alerts) → perimeter table §0 is the standing refusal, feed cap ≤1 competitor action/week.
**Open questions for founder:**
1. Competitor caps per plan — proposal 0 / 2 / 5 / 15 (Free/Creator/Growth/Agency): confirm?
2. C3 launch monitoring: include competitor *blog RSS* as a fourth public source (cheap, clearly public, but increases the "watching" surface)? My recommendation: yes for changelog/blog *index* pages via C2's protocol, no dedicated RSS ingestion until asked.
3. Ratify the tone rule (reference points, never enemies) as UI-template law — it's cheap now and impossible to retrofit once copy sprawls.
