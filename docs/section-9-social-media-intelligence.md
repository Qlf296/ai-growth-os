# AI Growth OS — Section 9: Social Media Intelligence

**Status:** Proposed v1 — pending founder review
**Depends on:** Section 4 §3–4 (social & community pipelines — the owners of processing), Section 7 (LinkedIn reality, Reddit/HN, ADR-020 UTM), Section 8 (baselines w/ maturity, event register), ADR-012 (epistemic levels), ADR-025 (interpretation never replaces measurement)
**Scope discipline — the founder's warning, answered first:** this section introduces **no social brain, no summarizing agent, no new decision layer**. The social and community pipelines from Section 4 remain the only processors; the Action Engine remains the only decider. Section 9's territory is exactly what Section 4 left open: making social content *learnable* — the taxonomies, profiles, and etiquette knowledge that turn "post something" into "post the kind of thing that works for you, here, now." All of it is **data consumed by existing pipelines**, not a new component that thinks.

---

## 0. What Social Intelligence Means Under Our Constraints

We cannot read feeds (LinkedIn), we measure primarily through our own UTMs + optional manual entry (ADR-020), and community reading arrives Phase 2 (Reddit/HN). So social intelligence here is honest and narrow: **learn what the founder's own publishing produces, and encode how communities work — then let the existing pipelines use both.** Four assets, all stored as data:

```
9.1 Content Taxonomy        what kinds of content exist (classification schema)
9.2 Voice Profile           how this founder writes (learned, never invented)
9.3 Timing & Cadence Model  when to publish (baseline-maturity gated)
9.4 Community Playbooks     how each community works (etiquette as rules)
        │
        ▼
consumed by: Social pipeline (drafting, cadence Actions)
             Community pipeline (opportunity filtering, reply drafting)
             Experiment Engine (format hypotheses)
             KB (learnings with n and epistemic level)
```

## 1. Content Taxonomy (9.1) — the learnable features

**ADR-026 — one controlled taxonomy, stored as data, versioned.** Without shared vocabulary, "founder-story posts outperform" is unlearnable — each draft would be a snowflake. With it, every published piece gets classified (tier 3, one small-model call per post, ~200 tokens) along four axes:

- `format`: founder_story | how_to | data_insight | opinion | question | announcement | case_study
- `hook_type`: personal | contrarian | curiosity_gap | number_led | question_led
- `topic`: from the workspace's topic clusters (SEO pipeline already computes these — reused, not duplicated)
- `cta`: none | soft_link | direct_link | discussion

Performance learning then happens at the **taxonomy-cell level with n displayed** ("founder_story × personal hook: 2.1× median clicks, n=9 — observation"), which is exactly the KB grammar from ADR-012. Cells below the baseline-maturity floor say so instead of trending noise (ADR-022 amendment applies verbatim here).

The taxonomy is global (comparability across workspaces for future global observations) but **extensible per workspace only by the system proposing + founder confirming** — uncontrolled vocabulary growth would quietly destroy learnability.

## 2. Voice Profile (9.2) — learned from edits, never fabricated

The drafting quality problem is really a voice problem: generic drafts get rewritten or rejected, and both outcomes waste the tier-4 call (ADR-011's economics depend on acceptance).

**ADR-027 — the Voice Profile is learned exclusively from the founder's own material and edit behavior:**

- **Sources, in trust order:** (1) the diff between generated drafts and what the founder actually publishes/copies — *every edit is a lesson* (stored as structured deltas: shortened?, de-jargonized?, emoji removed?, CTA softened?); (2) past posts the founder explicitly imports; (3) the strategy interview's stated preferences. Nothing else — no scraping "similar founders," no invented persona.
- **Representation:** a compact structured profile (sentence-length distribution, formality register, first-person usage, emoji/formatting habits, banned/favored phrases, language mix FR/EN) + a few exemplar snippets, injected into drafting prompts under the Gateway's context budget. Deliberately not a fine-tune (founder-ratified rationale: hard to explain, hard to delete, privacy weight, unnecessary): profiles-as-data are inspectable, editable, and cost nothing to update.
- **Settings → My Writing Style (founder-ratified page):** renders the profile in plain language — *"How AI currently understands your voice: Tone: professional but conversational · Sentences: short · Emoji: rare · Avoid: 'revolutionary', 'game changer'"* — every field correctable, corrections take effect on the next draft. The founder must be able to correct their AI; this page is that right, made visible.
- **Cold start honesty:** before ~5 published samples, drafts are labeled "early draft — I'm still learning your voice" and lean on the interview's register choice. The label removes the trust cliff of a bad first draft.
- **Privacy note:** edit-diff learning processes the founder's own authored content within their workspace — no cross-workspace voice data, ever.

## 3. Timing & Cadence Model (9.3)

Small and disciplined, because timing advice is where growth tools traditionally bluff:

- Per-workspace posting-time observations accumulate against **maturity-gated baselines** (Section 8 amendment) — before maturity, the system uses global heuristics *labeled as such* ("observation from other audiences — not yet verified for yours").
- Cadence guardian (Section 4 §3) reads declared rhythm from Strategy Profile constraints; its Actions carry the *reason* ("consistency compounds reach") from KB, not guilt copy (ADR-014 posture).
- **No "best time to post" theater:** the model never claims minute-level precision; slots are day×daypart cells, and only cells with mature baselines get asserted. ADR-025 applies: every timing claim must survive "why do you believe that?" with rows, not vibes.

## 4. Community Playbooks (9.4) — etiquette as enforceable rules

Formalizing your Section 4/5 decision into schema:

```sql
community_playbooks (
  id, community text,             -- 'reddit:r/resumes' | 'hn' | 'producthunt'
  promotion_policy text,          -- 'forbidden' | 'strict' | 'tolerated' | 'open'
  self_promotion_allowed bool,
  preferred_behavior text,        -- 'educational' | 'discussion' | 'show_dont_sell'
  disclosure_required bool,
  risk_level text,                -- 'high' | 'medium' | 'low'
  participation_caps jsonb,       -- {replies_per_week: 2, min_days_between: 3}
  sources jsonb,                  -- rule links, sidebar refs, collected_at (same provenance discipline as benchmark_sources)
  epistemic_level text            -- our reading of the culture is itself an observation
)

community_reputation (            -- per workspace × community: our participation ledger
  workspace_id, community, replies_sent int, removed_count int,
  last_participation, standing text   -- 'building' | 'good' | 'at_risk' (rule-derived)
)
```

- Playbooks are **tier-0 rules for the community pipeline**: caps and policies filter opportunities *before* any model call — a forbidden-promotion subreddit never even generates a "reply here" candidate with a link in it.
- `community_reputation` makes the account-safety stance mechanical: `removed_count > 0` tightens caps automatically; `at_risk` pauses the community's opportunities and surfaces one honest Action ("your last r/resumes reply was removed — pausing suggestions there for 30 days; here's the rule it likely broke").
- Playbooks ship curated for the starter communities (ForgCV set: r/resumes, r/careerguidance, r/jobs, r/startups, HN) and update via a quarterly review job + immediate update on any removal event. Cultures drift; the provenance fields keep our reading auditable.

## 5. Drafting System (assembly, not architecture)

Nothing new structurally — this subsection only fixes the recipe the existing tier-4 on-accept call uses: `prompt = task frame + Voice Profile + top taxonomy cells for this goal (with n) + community playbook (if community reply) + UTM-tagged links (ADR-020) + language per Strategy Profile`. Output is schema-validated (Section 2 §8), passes a tier-3 brand-safety/claims check for community replies specifically (cheap, and the reputational asymmetry justifies it — a bad LinkedIn post embarrasses; a bad subreddit reply gets banned), then lands in the editable composer. The founder's edits close the loop back into 9.2.

**What drafting will never do**, recorded as product law: engagement-bait optimization ("you won't believe…"), fabricated personal anecdotes presented as the founder's, undisclosed promotion where a community expects disclosure, or publishing without the human's hand (Section 7 default stands).

## 6. Cost & Phasing

| Asset | Phase | LLM cost |
|---|---|---|
| Taxonomy classification | Launch | ~€0.01–0.02/ws/mo (per-post tier 3) |
| Voice Profile learning | Launch | ~€0 (structured diffing, tier 1; occasional tier-3 summarization) |
| Timing model | Launch (heuristic) → matures with data | €0 |
| Community playbooks + reputation | Phase 2 (with Reddit/HN) | €0 (rules) + reply safety checks ~€0.02 |
| Repurposing chains (blog→LinkedIn→…) | Phase 2, with full Content Strategist (Section 4 §5) | on-accept |

Total launch addition: **~€0.01–0.03/ws/mo.** The section adds learnability, not spend — consistent with every budget before it.

## 7. Architecture Review Delta (v0.9)

**New ADRs:** ADR-026 (controlled content taxonomy as versioned data; cell-level learning with n) · ADR-027 (Voice Profile learned only from the founder's own material + edit diffs; inspectable/editable; no fine-tuning, no cross-workspace data) · ADR-028 (community playbooks as tier-0 rules + per-community reputation ledger with automatic cap tightening).
**New risks:** R24 — voice learning creep (profile drifting from stylistic features into stored personal narratives) → profile schema is a closed set of stylistic fields, reviewed at each schema change · R25 — community culture misread despite playbooks → provenance + removal-triggered pause + human hand on every publish (already law).
**Open questions for founder:**
1. Voice Profile visibility: full "how I write" page in Settings (my recommendation — transparency builds trust and invites corrections that improve drafts) vs internal-only?
2. Manual stats entry (Section 7 open question, now consequential): the taxonomy learning in 9.1 works on UTM clicks alone, but engagement-level cells (reactions/comments) need the manual card. Confirm keeping it?
3. Ratify the "what drafting will never do" list as product law — it's the ethical perimeter of the whole social layer.
