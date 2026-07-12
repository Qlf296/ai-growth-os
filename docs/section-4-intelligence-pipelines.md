# AI Growth OS — Section 4: Intelligence Pipelines & Arbitration

**Status:** Proposed v1 — pending founder review
**Depends on:** ADR-003/004 (pipelines, no agent dialogue), D3 (ladder), D5 (LLM budgets), Section 3 schema, Founder Decisions §1–7
**Governing constraint:** every pipeline is a deterministic signal processor that *earns* its model calls. The Action Engine is the only decision layer. No pipeline talks to another pipeline; they share state through Signals, KB, and Actions.

---

## 0. New Supporting Entities (delta to Section 3)

```sql
strategy_profiles (          -- the founder's declared context; pipelines READ this, never invent it
  workspace_id PK,
  current_goal text,         -- 'awareness' | 'acquisition' | 'activation' | 'revenue' | 'retention'
  audience_segments jsonb,   -- [{name:'job_seekers', priority: 1}, {name:'recruiters', priority: 2}]
  stage text,                -- 'pre_launch' | 'early' | 'growing' | 'established'
  constraints jsonb,         -- {hours_per_week: 5, skills: ['writing'], languages: ['fr','en']}
  updated_at
)

growth_experiments (
  id uuid PK, workspace_id,
  hypothesis text, objective text,
  channel text,              -- for overlap detection
  status text,               -- 'draft'|'running'|'completed'|'abandoned'
  start_date, end_date, min_duration_days int,
  success_metrics jsonb,     -- same structured form as ADR-008
  baseline jsonb,            -- snapshotted at start (same rule as outcomes)
  result_summary text,
  evidence_strength text,    -- 'anecdotal' | 'directional' | 'strong'  ← never 'proven'
  kb_entry_id uuid NULL      -- learning promoted to KB, if any
)
-- actions.experiment_id uuid NULL  → added to actions table
```

Action fields added per Founder Decision 2: `business_goal`, `funnel_stage`, `target_audience`, `estimated_time_to_value`, `required_user_skill` — populated from `strategy_profiles` + pipeline context. `strategic_priority` intentionally **not** stored; goal alignment is a scoring input (§9).

KB epistemic levels (Founder Decision 7): `kb_entries.kind` gains `epistemic_level: 'hypothesis'|'observation'|'validated'`. Promotion criteria are hard rules: hypothesis → observation requires ≥1 completed experiment or ≥5 consistent outcome evaluations; observation → validated requires ≥3 independent confirmations across ≥6 weeks with no contradicting result. The system may never present a hypothesis with the language of a validated learning — enforced in the rendering layer, not left to prompt goodwill.

---

## 1. The Pipeline Framework (common shape)

Every pipeline is the same machine with different configuration:

```
Subscribed signal types
   ↓
TIER 0  rules (from `rules` table, workspace overrides global)
   ↓
TIER 1  deterministic scoring (pipeline-specific features)
   ↓
TIER 2  embedding lookup vs KB ("have we seen/learned this?")
   ↓
TIER 3  small model via Gateway (classify / extract / summarize)   [budgeted]
   ↓
TIER 4  frontier model via Gateway (strategy / drafting)            [rare, budgeted]
   ↓
Candidate Action(s) → Action Engine (arbitration, §9)
```

Framework guarantees, implemented once and inherited by all pipelines:

- **Idempotent:** re-running a pipeline over the same signals produces the same candidates (dedupe keys make duplicates free).
- **Explainable:** every candidate carries `evidence[]` (signal refs) + `reasoning_trace` (which rule fired, which KB entry matched, which tier produced the text). This is the raw material for Founder Decision 4's confidence explanations — the "why" is assembled from real trace data, never generated post-hoc by a model asked to sound convincing.
- **Budgeted:** per-pipeline `request_class` in the Gateway registry; the D5 annotation below is enforceable config, not documentation.
- **Testable:** golden-file tests per pipeline — fixed signal fixtures in, expected candidates out. A pipeline change that alters recommendations shows up in code review as a diff of decisions.

Confidence explanations (Founder Decision 4) are structured, then rendered:

```json
confidence_explanation: [
  {basis: 'historical_outcome', ref: 'kb:abc', text_key: 'similar_actions_worked', n: 6},
  {basis: 'signal', ref: 'signal:gsc:...', text_key: 'low_ctr_high_impressions'},
  {basis: 'heuristic', ref: 'kb:global:xyz', epistemic_level: 'observation'}
]
```

The UI renders these as the bulleted "High confidence because…" — and each bullet is clickable down to its evidence. Trust through auditability.

---

## 2. SEO Strategist Pipeline — **launch**

- **Signals in:** `gsc.query_stats`, `gsc.page_stats`, `gsc.index_coverage`, `ga4.landing_performance`.
- **Tier 0/1 (where ~95% of value lives at launch):** classic, deterministic SEO plays — high-impression/low-CTR pages (title/meta rewrite candidates), positions 8–20 "striking distance" keywords (content upgrade candidates), decaying pages (traffic drop vs own 8-week baseline), index coverage errors (technical fixes), orphan/cannibalizing pages. None of this needs a model; it needs good queries over `signal_rollups`.
- **Tier 3:** cluster related queries into topics (embeddings + small model labeling) to recommend *one* content upgrade instead of twelve keyword-level nags.
- **Tier 4:** drafting — rewritten title/meta variants, content-brief outlines — only when the user accepts the Action ("generate on accept," not speculatively). This single choice cuts tier-4 volume by the dismissal rate.
- **LLM Budget (D5):** ~€0.02–0.05/workspace/month at launch cadence (weekly run + on-accept drafting). Free tier: tiers 0–2 output only — the recommendation appears, drafting is a paid feature.
- **Success criteria emitted:** `gsc.clicks` / `gsc.ctr` on target page, 28-day window — fully auto-evaluable. This pipeline is the closed loop's best training ground, which is another reason it launches first.

## 3. Social Strategist Pipeline (LinkedIn-reality edition) — **launch**

- **Signals in:** `linkedin.own_post_stats`, `forgcv.internal` referral traffic, posting-history rhythm.
- **Tier 0/1:** cadence guardian (gap vs declared rhythm → "you haven't posted in 9 days" with the *reason it matters* pulled from KB), post-performance deltas vs the workspace's own rolling median (never vanity absolutes), best-slot observation (only after enough posts — before that, global heuristics labeled as such, per epistemic-level rules).
- **Tier 3:** classify the user's own posts (format, topic, hook type) so performance patterns become learnable features ("founder-story posts outperform your feature announcements 2.1x — observation, n=9").
- **Tier 4:** post drafting from Strategy Profile + top-performing patterns + optional user-provided context. Draft-and-deep-link per the LinkedIn decision; never auto-publish.
- **LLM Budget:** ~€0.05–0.12/workspace/month (drafting dominates; on-accept only).
- **Honesty note baked into copy:** this pipeline improves *what and when the user publishes*; it does not "monitor LinkedIn" (R12). Opportunity discovery is the Community pipeline's job, on platforms that permit it.

## 4. Community Discovery Pipeline (Reddit / HN / Product Hunt) — **phase 2, design-complete now**

- **Signals in:** `reddit.post` / `reddit.comment` (subreddit watchlist), `hn.item` (keyword match), `ph.launch` (category watch). All via official/public APIs — this is where the "engagement opportunity" vision from Section 1 actually lives.
- **Tier 0:** watchlist + keyword rules (rules-as-data; the founder curates subreddits/keywords, seeded from Strategy Profile).
- **Tier 1:** opportunity score = relevance (embedding sim to workspace KB) × momentum (velocity vs subreddit norm) × answerability (question-shaped? unanswered?) × freshness decay. Deterministic, cheap, tunable.
- **Tier 3:** for the top ~5/day only — stance check ("is participating here on-brand and non-spammy?") + thread summary.
- **Tier 4:** reply drafting on accept. **Hard product rule:** drafts must add genuine value and disclose affiliation where the community expects it; Reddit self-promotion norms are encoded as tier-0 rules per subreddit (frequency caps, sub-specific etiquette from KB). Getting the founder banned from r/resumes is a catastrophic own-goal — the pipeline's job is *reputation-building*, and the arbitration layer caps community actions per week accordingly.
- **LLM Budget:** ~€0.10–0.25/workspace/month at 5 evaluations/day. The polling cost (API quotas) is the real constraint, priced into plan tiers per Section 2 §10.

## 5. Content Strategist Pipeline — **launch (lite) → phase 2 (full)**

- **Inputs:** SEO pipeline's topic clusters, social performance patterns, KB validated learnings, Strategy Profile.
- **Launch scope (lite):** a weekly content-planning Action assembled at tier 1–2 — "this week: 1 striking-distance content upgrade + 2 LinkedIn posts in your best-performing format" — composed from other pipelines' outputs and the calendar rhythm. Zero new model calls; it's orchestration of existing intelligence.
- **Phase 2:** full editorial calendar, brief generation, repurposing chains (blog → LinkedIn → newsletter) at tier 4 on accept.
- **LLM Budget:** launch ≈ €0; phase 2 ≈ €0.10–0.30 on-demand.
- *Challenge note:* I considered making this a launch-scope tier-4 feature and rejected it — until the SEO and Social pipelines have produced a few weeks of real signals and outcomes, a "content strategy" would be generic advice wearing a personalized costume. The lite version is honest; the full version becomes valuable exactly when the data does.

## 6. Competitor Analysis Pipeline — **phase 2, scoped narrowly**

- **Reality check first (this is the section's biggest pushback):** "competitor intelligence" is where growth tools traditionally burn money and skirt legality. SERP-rank tracking requires paid data providers (real COGS per keyword — this must enter plan pricing); scraping competitor sites is legally gray in the EU and operationally fragile; social competitor monitoring is API-forbidden almost everywhere (same R1 as LinkedIn).
- **Scoped launch-of-phase-2 version:** (a) SERP overlap via a *single* paid SERP API for the workspace's tracked keywords — competitor = "who outranks you where you have striking-distance positions," which converts directly into SEO Actions; (b) public, low-frequency page-change detection on ≤5 competitor URLs the user explicitly nominates (pricing pages, changelogs) with polite crawling of pages robots.txt permits; (c) Product Hunt / HN launch monitoring (public APIs).
- **Explicitly out of scope until a dedicated legal/cost review:** social competitor analytics, traffic estimation, full-site crawling. When Section 12 arrives, it will be reviewed against this boundary.
- **LLM Budget:** ≈ €0.05/workspace/month; the SERP API cost (≈ €0.50–2.00/workspace/month depending on keyword count) is the dominant line and gates this to Growth plan and above.

## 7. Conversion Optimization Pipeline — **launch (because ForgCV adapter exists)**

- **Signals in:** `forgcv.internal` funnel events (visit → signup → activation → retention → referral), `ga4.landing_performance`.
- **Tier 0/1:** funnel-step delta detection vs rolling baseline (signup rate drop on a landing page, activation dip after a release), segment comparisons (traffic source × conversion), leak ranking (which step loses the most absolute users — the highest-leverage question in early-stage growth).
- **Tier 3/4:** hypothesis suggestions for the biggest leak ("signup form on /templates converts 40% below site median — candidate causes from KB: form length, value-prop mismatch, mobile layout") → naturally feeds the Experiment Engine.
- **LLM Budget:** ~€0.03–0.08/workspace/month.
- This pipeline is why the ForgCV adapter decision matters: it's the only pipeline touching the Revenue/Conversion metrics of the Core Principle, and it makes the dogfooding loop complete — the Growth OS optimizing its sibling product with measurable funnel truth.

## 8. Experiment Engine — **launch (minimal) — this is the scientific spine**

Not a pipeline (it doesn't consume external signals); a lifecycle manager over `growth_experiments`:

1. **Creation:** from a pipeline's hypothesis-type Action ("run a 3-week founder-story post experiment") or user-initiated. Hypothesis + structured success metrics + baseline snapshot + `min_duration_days` are mandatory at creation — an experiment without a falsifiable metric is refused at the domain layer.
2. **Overlap guard:** one running experiment per channel per workspace (hard rule at launch). Confounded experiments teach false lessons, and false lessons in the KB are worse than no KB — they'd corrupt every future recommendation that cites them.
3. **Orchestration:** the experiment emits its constituent Actions over its duration (tagged `experiment_id`), which flow through normal arbitration — an experiment doesn't bypass the feed cap; it *competes* within it, weighted by the strategy profile's current goal.
4. **Evaluation:** at `end_date`, the outcome job compares metrics vs baseline → `evidence_strength: anecdotal | directional | strong` assigned by hard rules (duration met? n above floor? effect size vs baseline noise?). Never "proven," per the founder refinement.
5. **Learning promotion:** result → KB entry at the epistemic level its evidence supports, citing the experiment. The KB sentence the founder gave — *"Founder-story posts Tuesday 9AM produced 2.4× engagement, n=18"* — is this mechanism's output format, with `n` always displayed.
- **LLM Budget:** ≈ €0.02 (tier-4 only for result narrative on completion).

## 9. Arbitration System — the Action Engine's decision layer

Single deterministic function, runs after every pipeline batch and before every feed assembly:

```
priority_score =
    w_goal    · goal_alignment(action.business_goal, strategy_profile.current_goal)
  + w_impact  · impact_tier_value
  + w_conf    · confidence_value            (evidence-derived, §1)
  + w_effort  · effort_fit(effort_minutes, profile.constraints.hours_per_week)
  + w_affinity· category_affinity           (dismissal learning, nightly)
  + w_outcome · origin_track_record         (per-pipeline outcome success rate — pipelines EARN trust)
  + w_time    · urgency_decay(expires_at)
```

Then, in order: **dedupe** (Section 3 keys) → **prerequisite gating** (unmet prerequisite → the prerequisite becomes the Action) → **diversity constraint** (feed of 5 never contains >2 Actions of one category — a wall of SEO chores reads like a dashboard's to-do dump, violating P1) → **experiment quota** (running experiment gets its scheduled slot) → **feed cap** (plan-limited, D7) → remainder to backlog with expiry.

Properties worth stating: weights `w_*` start hand-set and conservative, are **stored as data** (per-workspace overridable), and the outcome loop tunes them slowly and boundedly — no self-reinforcing runaway where one pipeline monopolizes the feed because it recommends easy wins. `origin_track_record` is the quiet keystone: a pipeline whose completed Actions keep missing their success criteria loses feed share *mechanically*. That is the "learns what works" promise of Section 1, reduced to an implementable feedback term.

Dismissal meta-question (Founder Decision 3): triggered at the 3rd dismissal of a category, inline card, ≤1 per category per 14 days; answers map to mechanics — `wrong_timing` → snooze category 30d (no affinity penalty), `too_difficult` → effort filter tightens + `required_user_skill` gate, `already_done_elsewhere` → prompts the missing integration, `not_my_strategy` → strategy-profile edit suggestion + suppression at 7 stands.

---

## 10. Launch Scope Summary (challenge-tested)

| Pipeline | Launch? | Dominant tier | LLM €/ws/mo | Rationale |
|---|---|---|---|---|
| SEO Strategist | ✅ | 0–1 | 0.02–0.05 | Best signal quality, auto-evaluable outcomes |
| Social (LinkedIn) | ✅ | 0–1, T4 on-accept | 0.05–0.12 | Founder decision; API-reality scoped |
| Conversion (ForgCV) | ✅ | 0–1 | 0.03–0.08 | Revenue metric coverage; dogfooding |
| Content (lite) | ✅ | 1–2 | ~0 | Orchestration of other pipelines |
| Experiment Engine | ✅ minimal | — | 0.02 | The learning spine; must exist from day one |
| Community (Reddit/HN/PH) | Phase 2 | 0–1, T3 top-5/day | 0.10–0.25 | API-feasible opportunity discovery |
| Competitor | Phase 2, narrow | 0–1 | 0.05 + SERP API | Legal/cost boundary defined above |
| Content (full) | Phase 2 | 4 on-accept | 0.10–0.30 | Needs real data to be non-generic |

Total launch LLM COGS ≈ **€0.12–0.27 per active workspace/month** — inside the Section 2 ceiling with 3–6× headroom for the tier-4 daily synthesis (which I'm keeping *out* of launch scope: with only four pipelines, deterministic feed assembly + per-action rationales already tell the day's story; the narrative "Growth Coach" synthesis earns its cost when pipeline volume makes the feed need editorial judgment. ADR-004's "one legitimate exception" stays reserved, unused).

## 11. Architecture Review Delta (v0.4)

**New ADRs:**
- ADR-010: Strategy Profile as the single source of business context; pipelines read, never invent.
- ADR-011: Tier-4 generation is on-accept, not speculative — drafting cost scales with acceptance, not recommendation volume.
- ADR-012: Experiment overlap guard (one per channel) + evidence-strength labeling; KB promotion criteria are hard rules.
- ADR-013: Arbitration weights as bounded, slowly-tuned data; pipeline feed-share earned via outcome track record.

**New risks:**
- R14: Community pipeline reputational risk (spam perception, subreddit bans) → etiquette rules-as-data, weekly caps, on-accept drafting, disclosure norms.
- R15: KB corruption via underpowered experiments → epistemic levels + promotion criteria + overlap guard.
- R16: SERP API cost creep with keyword count → keyword cap per plan, cost surfaced in D5 reviews.

**Open questions for founder:**
1. Reddit watchlist curation at onboarding: system-suggested subreddits from Strategy Profile with user confirmation — acceptable, or fully manual? (Suggested-with-confirmation is my recommendation; cold-start relevance is much better.)
2. Growth-plan keyword cap for SERP tracking (cost lever): proposal 50 keywords.
3. Confirm launch scope table above — especially deferring the daily narrative synthesis.
