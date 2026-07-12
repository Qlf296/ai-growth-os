# AI Growth OS — Section 16: Recommendation Engine (Definitive Specification)

**Status:** Proposed v1 — pending founder review
**Nature:** this is the referential's keystone section — and, honoring the maturity rule, it introduces **no new concepts and no new ADRs**. Every term below was decided somewhere in Sections 3–15; this document assembles them into one executable specification: the single deterministic function that turns candidate Actions into the Today feed. It is long on precision and short on novelty, which is exactly what a decision core should be.
**Owner of:** scoring, arbitration, ranking, feed assembly, learning-parameter updates. **Explicitly not owner of:** opportunity detection (pipelines), state analysis (Section 8), verdicts (Section 11), delivery (Section 13).

---

## 0. The Function, Named

```
assemble_feed(workspace, date):
  candidates  = intake()           §1   validate contracts
  eligible    = gates(candidates)  §2   hard filters — no scoring of the ineligible
  scored      = score(eligible)    §3   THE formula
  arranged    = arrange(scored)    §4   dedupe → group → diversity → experiment slot → cap
  feed        = commit(arranged)   §5   traces, stability, backlog
  return feed                           deterministic: same inputs + same config versions → same feed
```

Determinism is a contract (ADR-045 depends on it): stable sort with total tie-breaking (final tie-break: action UUID), no randomness except the seeded exploration slot (§4.4), every run records `config_versions`, `rules_version`, and emits a decision_trace per action (ADR-044).

## 1. Intake Contract

A candidate is rejected (with ledgered reason — pipelines learn from their rejects via ADR-042 funnels) unless it carries: workspace, category, origin(+detector), title, rationale, evidence[] (≥1 real reference — ADR-035 applies at intake, not just render), structured success_criteria or `evaluability ∈ {manual, none}` declared, effort_minutes, impact_tier, confidence (evidence-derived, from the pipeline's structured explanation), dedupe_key, expires_at, business context fields (from Strategy Profile per ADR-010 — never pipeline-invented).

## 2. Hard Gates (order matters; a gate failure is not a low score — it is ineligibility)

1. **Capability** (ADR-041): action requiring a `forbidden/unavailable` capability → rejected at intake, should never have been emitted (CI conformance catches the pipeline bug).
2. **Prerequisites** (Section 3): unmet → the *prerequisite* becomes the candidate; the original waits, linked.
3. **Plan limits** (ADR-009/plans): tier-4-dependent actions for free tier → rules/KB-only variant or suppressed.
4. **Freshness** (ADR-039): a candidate whose *strongest* evidence is stale knowledge → confidence capped at Medium (label-honest), and if stale evidence is its *only* support → rejected ("we'd be recommending from a museum").
5. **Community caps** (ADR-028): playbook weekly caps and `at_risk` standing filter community candidates pre-score.
6. **Stability** (Section 13 rule): superseded/in-flux candidates wait a cycle.

## 3. The Scoring Formula (definitive, all coefficients in config registry with `stability` tags)

```
base(a)  =  w_goal·G(a) + w_impact·I(a) + w_conf·C(a) + w_effort·E(a) + w_urg·U(a)        ∈ [0,1]
score(a) =  base(a) × M_affinity(a) × M_track(a) × M_bottleneck(a)
```

**Additive terms** (each normalized to [0,1]; weights sum to 1; launch values `experiment`-tagged):

| Term | Source | Definition |
|---|---|---|
| **G** goal alignment | Strategy Profile + weekly focus (Section 8.5) | mapping table `business_goal × current_goal → [0,1]`; focus match adds the focus bonus (config); user focus-override respected instantly (`user_strategy_override`) |
| **I** impact | pipeline's tier | High/Med/Low → {1.0, 0.6, 0.3} (config) — tiers, never fabricated numbers (D2) |
| **C** confidence | evidence-derived label | High/Med/Low → {1.0, 0.65, 0.35}; **never mutated by track record** (Section 6 clarification — the label is sacred; performance lives in M_track) |
| **E** effort fit | effort_minutes vs Strategy Profile `hours_per_week` + skill gate | piecewise: fits-easily 1.0 → oversized 0.2; `required_user_skill` mismatch → 0 (gate-like but graded for adjacent skills) |
| **U** urgency | expires_at decay | 1 at horizon, decaying; most actions have low U by design — scarcity of urgency is a feature |

**Bounded multipliers** (all ranges config-governed, all effects visible in decision_trace):

| Multiplier | Source | Bounds | Notes |
|---|---|---|---|
| **M_affinity** | reason-weighted dismissal learning (founder formula: dismissals × recency_weight × reason_weight) + completions as positive signal | **[0.5, 1.2]** | `no_time` decays fast; `not_relevant` bites; suppression at 7 handled as gate, not multiplier |
| **M_track** | origin/detector graded success rate (ADR-033 weights: A full, B+ high, B reduced, C minimal) | **[0.7, 1.3]** | multiplicative per founder decision; EWMA with α in config (`experiment`), grade-weighted, min-n floor before deviation from 1.0 |
| **M_bottleneck** | Growth Model bottleneck stage match | **[1.0, 1.3]** | founder-capped; abstaining detector → 1.0 for all |

Compound bound: multipliers may jointly move a score by at most ×[0.35, 2.03] — wide enough to matter, narrow enough that **base value (evidence, goal, impact) always dominates learned adjustment**. That proportion is the product's character encoded in arithmetic: the system's opinions can tilt the table; they can never flip it.

**Ordering invariant (founder amendment, explicit):** *no combination of multipliers may invert the ordering of two actions whose base scores differ by more than the invariant margin* (`ordering_invariant_margin`, config; derivable from the bounds — with launch bounds, two base scores >2.9× apart can never swap; the config key lets us tighten it further). Learning must never put a bad idea ahead of an excellent one. Enforced as a property-based test over the score function, not just prose.

## 4. Arrangement

1. **Dedupe** (Section 3 keys) — includes cross-pipeline dedupe: two pipelines targeting the same entity/intent merge evidence into the higher-scored candidate (ADR-031's logic generalized).
2. **Grouping** — page-level merge for SEO (ADR-031), thread-level for community.
3. **Diversity constraint** — max 2 of any category in a feed of 3 (config: `max_per_category`); prevents monoculture even when one pipeline is hot.
4. **Exploration slot** — the cold-start/starvation answer, and the one place randomness exists: with config probability (proposal `exploration_rate = 0.1`, seeded per workspace×date for replayability), one backlog-or-new-origin candidate that *passed all gates* but scored below the cut is included, **labeled honestly in the UI** ("worth trying — we have less evidence here"). Without exploration, M_track can never form for new detectors and the rich-get-richer loop ossifies the feed; with it unlabeled, we'd violate P5. Labeled exploration threads that needle — and its acceptance rate is itself an ADR-042 health metric.
5. **Experiment slot** — a running experiment's due action takes its scheduled place (Section 4 §8), competing within the cap, never suspending it.
6. **Cap** — plan feed size (default 3, D7). Remainder → backlog ordered by score, expiring per `expires_at`; backlog entries re-enter future intakes automatically.

## 5. Commit, Trace, Learn

- **Commit:** feed snapshot + per-action decision_trace (scores, terms, multiplier values, config/rules/prompt-template versions, gate results, exploration flag) — assembled now, not reconstructed (ADR-044).
- **Stability:** committed feed is what Delivery may reference (Section 13); intra-day changes only via the acute path.
- **Nightly learning update (the only writer of M inputs):** recompute affinities (reason-weighted, recency-decayed) and track records (grade-weighted EWMA) from action_events + graded verdicts. Step sizes bounded (config, `experiment` initially). **Any change to weights `w_*`, multiplier bounds, mapping tables, or gate thresholds is decision-affecting and therefore requires mandatory shadow evaluation (ADR-045) before activation** — the founder-ratified gate, now sitting exactly where it bites.
- **Cold start:** all multipliers = 1.0 until min-n; G from interview; labeled global heuristics fill evidence (Section 5 §2 posture). The first feed is honest, specific where data exists (GSC backfill), and labeled where it doesn't.

## 6. Anti-Pathology Register (each guard already exists; listed as the engine's self-checks)

Monoculture → diversity constraint · ossification → exploration slot + M bounds · oscillation → weekly focus stickiness + EWMA smoothing + dedupe cooldowns · rich-get-richer → M_track bounds + min-n floors · nag loops → affinity + suppression + Section 13 budget · fabricated confidence → C is evidence-only, gates 4 & intake evidence requirement · silent drift → shadow-eval gate + ADR-042 funnels + decision traces.

## 7. Delta

**No new ADRs. No new risks.** Config keys introduced (all `experiment` at launch): `w_goal/w_impact/w_conf/w_effort/w_urg`, tier/label mappings, multiplier bounds, `exploration_rate`, EWMA α, min-n floors, `max_per_category`. LLM cost: **€0** — the decision core is pure arithmetic over governed data, which is what fifteen sections of discipline were for.
**Open questions — resolved by founder:** weight vector `.30/.25/.20/.15/.10` confirmed as `experiment` starting point ✓ · `exploration_rate = 0.1`, configurable, honest label mandatory ✓ · raw scores never shown — the user sees rank and the trace-backed "why", scores are internal mechanisms ✓.
