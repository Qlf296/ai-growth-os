# AI Growth OS — Section 5: Product Experience (Action-First UX)

**Status:** Proposed v1 — pending founder review
**Depends on:** P1 (Action First), D7 (capped feed), ADR-008 (evaluable criteria), ADR-010 (Strategy Profile), §1 of Section 4 (structured confidence explanations)
**One-sentence brief:** every morning, the product must produce the feeling *"my growth expert tells me exactly what to do and why"* — which means the UX's real job is manufacturing trust, and trust is built from honesty, brevity, and visible track record.

---

## 0. Information Architecture

Four surfaces. Not five, not nine.

```
┌──────────────────────────────────────────────┐
│  TODAY        ← home, always. The product.    │
│  EXPERIMENTS  ← the scientific spine, visible │
│  LEARNINGS    ← KB + track record (trust)     │
│  SETTINGS     ← connections, profile, plan    │
└──────────────────────────────────────────────┘
```

There is deliberately **no "Analytics" tab**. Metrics appear only as evidence inside Actions, inside experiment results, and inside Learnings. The moment we ship a standalone charts page, we've built the product this spec exists to avoid. (If users demand raw exploration, the pressure valve is "view in GA4/GSC" deep links from evidence drawers — we route to the tools that already do dashboards well.)

---

## 1. TODAY — the Action Feed

### 1.1 Anatomy

```
┌────────────────────────────────────────────────┐
│  Vendredi 11 juillet                            │
│  Focus this week: Acquisition                   │  ← from Strategy Profile
│                                                 │
│  ●●○  2 of 3 done today                         │  ← momentum, not gamification
├────────────────────────────────────────────────┤
│  1 ▸ Rewrite the title of /cv-sans-experience   │
│      Why: 4,800 impressions, CTR 1.1% — half    │
│      your site median. High intent query.       │
│      [Impact: High] [Confidence: High] [~15 min]│
│                                                 │
│      ┌──────────┐ ┌────────┐ ┌─────────┐        │
│      │ Start ▸  │ │ Snooze │ │ Dismiss │        │
│      └──────────┘ └────────┘ └─────────┘        │
├────────────────────────────────────────────────┤
│  2 ▸ Publish this week's founder-story post     │
│      Why: your best format (2.1× median, n=9);  │
│      9 days since last post.                    │
│      [Impact: Med] [Confidence: Med] [~20 min]  │
├────────────────────────────────────────────────┤
│  3 ▸ 🧪 Experiment day 6/21: post #4 ready       │
│      Founder-story series — draft prepared.     │
├────────────────────────────────────────────────┤
│  Backlog (4)                          ▾ folded  │
└────────────────────────────────────────────────┘
```

Rules that make this screen work:

- **3 actions by default** (plan-capped ceiling 5–10, user-adjustable). The founder asked the home screen to answer "the 3 most important things" — 3 is the default, not the maximum.
- **The "Why" is one sentence on the card.** Not a paragraph. The full reasoning lives one tap away (§4). Brevity on the card, depth on demand — progressive disclosure is the entire visual philosophy.
- **Every card has a primary verb.** "Start" opens the doing surface (§1.2). Never a card whose only affordance is reading.
- **Order is arbitration order.** No manual re-sorting on Today (backlog is browsable). If the user disagrees with priority, that's what Dismiss-with-reason is for — disagreement is training data, and the feed must visibly *react* to it over time.
- **Backlog folded by default.** It exists (completeness, D7), it is visually secondary (hierarchy).

### 1.2 The doing surface (accept flow)

Tapping **Start** must reduce the work, not describe it:

- SEO title rewrite → side-by-side: current title/meta + 3 generated variants (tier-4 on-accept, ADR-011) + "copy" + deep link to the CMS/GSC page + "mark done."
- LinkedIn post → prepared draft in an editable composer → "Copy & open LinkedIn" (deep link). The human publishes — the UI states this plainly.
- Technical SEO fix → the exact affected URLs, the exact fix, a "how" foldout matched to `required_user_skill`.
- On **Done**: one screen — "Success will be measured: clicks on this page over the next 28 days (baseline: 46/wk). We'll report back." This sentence is ADR-008 made visible, and it's the promise that the *next* screen (§5) keeps.

### 1.3 Dismiss / snooze

Dismiss requires one tap on a reason (the Section 3 enum, rendered as chips: *Pas pertinent · Pas le temps · Déjà fait · Je ne comprends pas · Autre*). Snooze offers tomorrow / next week / "when I have more time" (maps to effort-fit re-weighting). The category meta-question (Founder Decision 3) appears as an inline card after the 3rd same-category dismissal, ≤1/category/14 days — one question, chip answers, dismissible itself.

---

## 2. Onboarding — time-to-first-real-action is the metric

Target: **under 10 minutes to a feed of genuinely personalized Actions.** Not a tour. Not an empty state with confetti.

```
Step 1  Connect Google Search Console        (~2 min, OAuth)
        → backfill job starts IMMEDIATELY in background
Step 2  Strategy mini-interview               (~3 min, 6 questions max)
        goal · audience segments · stage · hours/week · skills · language
Step 3  Optional now, prompted later: GA4, LinkedIn, ForgCV
Step 4  First-run analysis moment
        "Analyzed 214 queries across 38 pages. Found 6 opportunities."
        → Today feed renders, real actions, from tier-0/1 rules over backfill
```

Design commitments:

- **GSC first, always.** It's free, it backfills 16 months of history instantly, and tier-0/1 SEO rules produce credible, specific Actions from it *on day one*. This is the cold-start answer: the first feed is real, not templated. (A user with no GSC/site gets the honest variant: strategy interview → community & LinkedIn actions + "connect your site when ready" as a prerequisite Action.)
- **The interview writes the Strategy Profile** (ADR-010) and the user sees it written back: "Got it — acquisition focus, job-seeker audience, ~5h/week." Editable forever in Settings; edits visibly re-rank the feed.
- **Step 4 is a designed moment.** The transition from "tool I just signed up for" to "expert who read my data" happens in one screen. It deserves craft: name the numbers, name the biggest single opportunity, then show the feed.
- Every unconnected integration becomes a **prerequisite Action in the backlog** ("Connect GA4 — 2 min — unlocks conversion insights"), never a nag banner.

---

## 3. Daily & Weekly Workflow

- **Morning (the ritual):** one push/email at the user's chosen time — *"3 actions today. #1: fix the CTR on /cv-sans-experience (15 min)."* Deep-links into Today. The digest IS the notification; there is no second morning ping.
- **During the day:** feed updates via SSE if something urgent enters (rare, rule-gated — see §6).
- **Friday (weekly review, 5 min):** a review-type Action, not a separate surface: what shipped, one outcome that reported back, what the coming week's focus is, one suggested strategy adjustment max. This is also where experiment progress is narrated.
- **Monthly:** the track-record moment (§5) — the single most trust-building screen we own.

## 4. Recommendation Explanations & Confidence Display

- Confidence is a **word, never a percentage** (High / Medium / Low). Fake precision is trust poison — this has been a standing decision since D2 and the UI enforces it.
- Tapping confidence or "why" opens the **evidence drawer**, rendered directly from the structured `confidence_explanation`:

```
┌────────────────────────────────────────────┐
│ High confidence — because:                  │
│ • This page: 4,800 impressions, 1.1% CTR    │
│   (your site median: 2.3%)      [see data]  │
│ • 6 similar title rewrites you completed    │
│   improved CTR within 4 weeks   [see them]  │
│ • Heuristic: striking-distance pages        │
│   respond fastest to title changes          │
│   [observation — from 12 workspaces]        │
└────────────────────────────────────────────┘
```

- Every bullet is a real trace reference (signal, KB entry, past outcome) — tappable to its source. **Epistemic badges** (hypothèse / observation / validé, ADR-012) render on every KB-derived bullet. The system is structurally incapable of dressing a hypothesis as a law, because the badge comes from the data, not the copy.
- When confidence is Low, the card says so *and says why it's still suggested*: "Low confidence — first experiment of this type for you. That's why it's framed as an experiment."

## 5. Learning History — the trust ledger

The LEARNINGS surface has three blocks, all generated, all honest:

1. **Track record:** "You've completed 23 actions. 14 met their success target, 4 partial, 3 didn't, 2 unmeasurable." Filterable by category. `unmeasurable` is displayed, not hidden — honesty here is what makes the "14 met" believable.
2. **What we've learned about your growth:** workspace KB entries with epistemic badges and their provenance ("from the founder-story experiment, June"). Each entry shows *how it's being used* ("this now boosts post-draft actions on Tuesdays").
3. **Outcome report-backs:** when an evaluation lands, it appears here AND as a feed item on Today: *"Result: /cv-sans-experience clicks +38% over 28 days — target met ✓."* Closing the loop **in the user's face** is the single strongest retention mechanic this product has. A report-back of a failure appears with the same prominence and a follow-up suggestion — the expert who admits misses is the one whose wins you believe.

## 6. Notifications — a budget, not a channel

**ADR-014: notification budget.** Defaults: 1 morning digest + max 1 urgent interrupt/day + weekly review + outcome report-backs (batched into the digest). Urgent interrupts are tier-0 rule-gated events only (site deindexation signal, connection broken, experiment post due today) — never "we found a new recommendation." Quiet hours by default (21:00–08:00, user TZ). Every notification type individually togglable. The anti-nag stance is architectural: Delivery module enforces the budget; pipelines cannot emit user-facing pings directly.

Rationale worth recording: this product's failure mode isn't silence — it's becoming *another guilty red badge*. An expert respects your attention; the notification budget is that respect, enforced in code.

## 7. Experiment Interface

- **Experiments tab:** one running experiment (per channel guard, ADR-012) as a progress card — hypothesis in plain words, day X/Y, metric vs baseline *so far* with a "too early to conclude" label until `min_duration_days` passes (the UI refuses premature conclusions just like the engine does).
- Experiment-generated Actions appear in Today tagged 🧪 — the feed stays the single workspace; the tab is for oversight, not a second to-do list.
- **Completion:** a result card — verdict, evidence strength (anecdotal/directional/strong, badge), what was learned, and the KB entry it created ("this learning now influences your post scheduling"). One-tap "run a follow-up" if directional.
- **Creation:** mostly system-proposed ("turn this hypothesis into a 3-week experiment?"); manual creation exists but is guided — hypothesis, one metric, duration — refusing unfalsifiable experiments at the form level, same rule as the domain layer.

## 8. Empty States & Degraded Honesty

Every surface has a designed truthful zero-state: Learnings before any outcome ("Your first results report ~28 days after your first completed action — here's what will appear"); Today when pipelines have nothing new (rare by design; the feed backfills from backlog); connection broken (prerequisite Action, §2). And one global rule: **when the system doesn't know, the UI says so in those words.** "Pas encore assez de données pour une recommandation fiable ici" is a feature. It's what makes every confident sentence mean something.

---

## 9. Architecture Review Delta (v0.5)

**New ADRs:** ADR-014 (notification budget, enforced in Delivery) · ADR-015 (GSC-first onboarding; first feed generated from backfill via tiers 0–1; "first-run analysis" as a designed moment).
**New risks:** R17 — feed feels stale if pipelines under-produce for low-data workspaces → mitigation: backlog backfill + global-heuristic actions clearly labeled as such + Audience Intelligence queries as an always-available action source. R18 — French/English content duality (founder audience is FR, tooling EN) → UI copy fully localized FR/EN from launch; generated drafts follow `strategy_profiles.constraints.languages`.
**Open questions for founder:**
1. Morning digest channel default: push (mobile PWA) vs email? Recommendation: email at launch (zero PWA-install friction, founders live in inboxes), push once the PWA habit exists.
2. The momentum indicator (●●○): keep it this quiet, or add streaks? My position: **no streaks** — guilt mechanics contradict the "respectful expert" posture, and a founder who takes a week off should return to a warm feed, not a broken chain.
3. Confirm "no Analytics tab" — this will be the most-requested feature we say no to, and I want it on record as a founder-level decision.
