# AI Growth OS — Section 11: Analytics Engine (Outcome & Evidence Layer)

**Status:** Proposed v1 — pending founder review
**Depends on:** Section 3 §7 (outcome schema, baseline-at-creation), Section 8 (baseline service, event register, ADR-025), ADR-012 (experiment evidence strength), ADR-020 (UTM), founder scope directive
**Scope, per the directive:** this engine answers **"did the action work?"** — never "what should we do?" It evaluates, attributes, and produces evidence; the results flow to the KB, arbitration weights, and reporting (Section 17). It holds no ranking logic, emits no recommendations, and cannot touch the feed. One asymmetry is deliberate: this layer may *veto claims* (mark them unmeasurable) but may never *create* them.

---

## 0. Position in the System

```
completed Actions / ended Experiments
            │  (scheduled: completed_at + window_days)
            ▼
   ANALYTICS ENGINE
   11.1 Outcome Evaluator      verdicts per criterion
   11.2 Attribution Grader     how much can we honestly claim?
   11.3 Learning Propagator    verdicts → KB / weights / track records
   11.4 ROI Ledger             effort in vs results out
   11.5 Evidence Generator     one service that renders proof everywhere
            │
            ▼
   KB entries · arbitration inputs · Learnings surface · Section 17 reports
```

Everything is deterministic (tier 0–1). The only model call in this section is the weekly review narrative already budgeted in Section 8 §6. **LLM budget: ~€0.**

## 1. Outcome Evaluator (11.1)

Formalizing Section 3 §7's job into precise mechanics:

- **Trigger:** `outcomes.evaluate` fires at `completed_at + window_days` per criterion (windows are action-type rules-as-data: CTR 28d, position 28–56d, funnel fixes 14–28d). A **midpoint peek** at window/2 exists solely for the *report-back teaser* ("early signal: trending above target") — clearly labeled interim, never producing a verdict early. Verdicts don't rush.
- **Verdict rules (deterministic):** `met` = observed ≥ target · `partial` = observed ≥ baseline + 50% of (target − baseline) but < target · `not_met` = below that · `unmeasurable` = data gap, criterion source disconnected, or attribution grade F (below). Thresholds per criterion class in rules-as-data.
- **Noise guard:** observed values are window aggregates compared against the **baseline snapshot taken at Action creation** (Section 3's non-negotiable) *and* sanity-checked against the shared baseline service's current MAD — a "met" that sits within noise of the old baseline gets demoted to `partial` with the honest note "within normal variation." Meeting a target by luck must not teach the system a false lesson (same corruption logic as R15).
- **Verdict audit trail (founder amendment):** every adjustment is stored, never silent — `outcome_evaluations` gains `original_verdict`, `adjustment_reason`, `baseline_snapshot_id`. Example row: original `met` → adjusted `partial`, reason "observed improvement within expected variance." The evaluator's own judgments are auditable, same standard we hold everything else to.
- **Re-evaluation:** exactly one, at 2× window, only for `not_met` verdicts on slow metrics (SEO position) — some wins are late, and closing them as failures forever would mistrain `origin_track_record`. One retry, then final.

## 2. Attribution Grader (11.2) — the section's core honesty machinery

**ADR-033 — every verdict carries an attribution grade, computed by rule:**

| Grade | Meaning | Criteria |
|---|---|---|
| **A — direct** | Our own tag ties result to action | UTM-keyed results (ADR-020), page-scoped GSC metric on the exact edited page |
| **B+ — direct-but-not-isolated** *(internal only)* | Our tag ties result to action, but register shows a plausible co-contributor | UTM-keyed result + concurrent campaign/deploy in same scope — UI shows "B"; learning weight sits between A and B (founder amendment) |
| **B — scoped correlation** | Metric moved in the action's narrow scope, clean window | Right page/segment + no competing events in register during window |
| **C — confounded** | Metric moved, but register shows co-occurring events | Deploy, Google update, other completed Action, running experiment in same scope |
| **F — unattributable** | Broad metric, no scoping possible | → verdict forced to `unmeasurable` |

- Grades render in UI copy: A → "clicks on this page +38% — target met ✓" · B → "improved during the window; likely related" · C → "improved, but a site deploy landed the same week — treat as partial evidence" · F → honest silence. The event register (ADR-024) is what makes grade C detectable at all — this is where that investment pays off.
- **Learning weights follow grades** (§3): A counts fully, B+ slightly below A (internal distinction only), B at reduced weight, C minimally, F not at all. R13 (attribution noise) is hereby structurally mitigated rather than worried about: verdicts are labeled evidence, and *how labeled* now has mechanics.

## 3. Learning Propagator (11.3) — one writer, three destinations

Verdicts propagate through a single code path (never ad-hoc writes — one auditable pen):

1. **KB:** repeated consistent outcomes create/promote entries under ADR-012's hard criteria, citing action IDs and grades (grade-A evidence only for promotion to `validated`).
2. **Arbitration inputs:** `origin_track_record` per pipeline/detector and `category_affinity` recompute nightly from graded verdicts — bounded step sizes (ADR-013's "slowly and boundedly" now has its data source).
3. **Experiment evaluation:** experiments reuse this exact evaluator over their metric set — `evidence_strength` (anecdotal/directional/strong) derives from verdict consistency × attribution grades × n × duration-met. One evaluator, two consumers; no second implementation to drift.

## 4. ROI Ledger (11.4)

**ADR-034 — effort accounting is honest-input only:** `effort_minutes` are our estimates unless the user corrects them (one optional tap on completion: "took about right / longer / shorter" — same light-touch pattern as LinkedIn stats). The ledger joins completed actions × graded outcomes × effort per category/channel, feeding Section 8's channel-efficiency view and the monthly track-record moment ("your 6 SEO hours this month produced 3 met targets, +214 estimated monthly clicks — grade-A measured"). **No euro-ROI theater at launch:** converting clicks to revenue requires conversion values the founder hasn't configured; the ledger speaks in measured units until ForgCV revenue events make real value attribution possible (then it's grade-graded like everything else).

## 5. Evidence Generator (11.5)

One rendering service — the same one behind Section 5's evidence drawers — now formally owns *all* proof surfaces: confidence explanations, outcome report-backs, experiment results, weekly review facts, Section 17 reports. Input: structured refs (signals, baselines, verdicts, grades, KB entries). Output: localized copy (FR/EN) from templates keyed to `text_key`s, every sentence carrying its data reference. **No prose about data is ever composed outside this service** — that's the enforcement point for ADR-025 and Product Law 8: a model can narrate *around* evidence blocks (weekly review), but the factual sentences themselves are template-rendered from rows.
- **Founder amendment (binding, technical):** no UI surface may display a number, percentage, comparison, or performance claim without an attached `evidence_reference_id`. Enforced at the component level: the numeric-claim UI components *require* the reference prop; a claim without evidence does not compile, let alone render.

**Hard UI rule (founder amendment):** no UI surface may display a number, percentage, comparison, improvement, or performance claim without an attached `evidence_reference_id`. Enforced at the component level — the metric-display components *require* the reference prop; a bare number doesn't compile. "Your SEO improved 42%" is unrenderable; "Clicks +42% · GSC signal #48291 · June 1–28 · Grade A" is the only shape that exists.

## 6. Architecture Review Delta (v0.11)

**New ADRs:** ADR-033 (attribution grades A/B/C/F; grades gate learning weights and UI claims; F forces `unmeasurable`) · ADR-034 (ROI ledger in measured units; no revenue conversion until real conversion values exist; user effort-correction as optional tap) · ADR-035 (single Evidence Generator owns all factual prose; single Learning Propagator owns all verdict write-backs).
**Risk updates:** R13 closed as designed-around (grades) · R15 mitigation extended (grade-A-only promotion to `validated`).
**New risk:** R28 — evaluation windows silently drifting from action-type reality (e.g., SEO wins arriving at week 10) → the one-retry rule + a quarterly meta-review job: distribution of late `met` verdicts per action type, feeding window tuning. The evaluator evaluates itself on schedule.
**Open questions — resolved by founder review:**
1. Grade-C outcomes: **shown**, with differentiated treatment — never victory styling; copy pattern: "CTR improved after this action, but another deployment happened during the same period. Treat as directional evidence." Hiding C would fabricate a success rate by omission.
2. Effort-correction tap: **optional forever** ("user data is a gift, not a tax"); a non-blocking accuracy prompt may appear at experiment close.
3. No euro-ROI: **ratified** — now ADR-034 + Product Law 15.
