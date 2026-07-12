# AI Growth OS — Section 8: Growth Intelligence Engine

**Status:** Proposed v1 — drafted by architect (no founder spec received for this section; scope claimed and delimited below)
**Depends on:** Section 4 (pipelines, arbitration), Section 3 (signals, rollups, KB), ADR-010 (Strategy Profile), ADR-013 (arbitration weights)
**Scope discipline — read first:** Sections 4 and 16 own *per-channel intelligence* and *recommendation scoring* respectively. If Section 8 re-specified those, we'd have two sources of truth. So Section 8 claims exactly the layer neither owns: **the shared analytical brain** — the cross-channel model of the workspace's growth that every pipeline reads and no pipeline computes. It answers the question Section 1 opened with ("what is the highest-impact action *right now*?") at the level above channels: *where is growth constrained this week?*

---

## 0. What This Layer Is (and is not)

```
                 Signals + Rollups (Section 3)
                          │
        ┌─────────────────▼──────────────────┐
        │      GROWTH INTELLIGENCE ENGINE     │
        │                                      │
        │  8.1 Baseline & Anomaly Services     │   shared statistical
        │  8.2 Growth Model (funnel state)     │   primitives — tier 0/1,
        │  8.3 Channel Efficiency Ledger       │   deterministic, ~€0 LLM
        │  8.4 Bottleneck Detector             │
        │  8.5 Weekly Focus Selector           │
        └───────┬──────────────┬───────────────┘
                │              │
        Pipelines read it   Arbitration reads it
        (evidence, context) (goal_alignment, weights)
                │              │
                └──── Weekly Review / digest narrate it
```

Not an agent, not a pipeline, not a report. A **computed state, refreshed daily**, stored as data, cited as evidence. It produces at most a handful of Actions itself (bottleneck and anomaly findings); its main job is making every *other* recommendation smarter and every rationale honest.

---

## 1. Baseline & Anomaly Services (8.1) — the statistical commons

Every pipeline so far has quietly needed "vs baseline": CTR below *site median*, posts vs *rolling median*, funnel step vs *its trend*. Left to each pipeline, we'd get five inconsistent definitions of "normal" — and inconsistent definitions of normal produce contradictory recommendations, which users read as the product arguing with itself. So baselines become one shared service:

- **`baseline(metric, dims, window)`** → rolling median + MAD (median absolute deviation) over `signal_rollups`. Medians, not means — one viral post or one crawler burst must not redefine "normal." MAD gives us robust "how unusual is this?" without pretending to Gaussian rigor.
- **Seasonality handling, minimal and honest:** day-of-week adjustment only (weekday/weekend traffic patterns are real and large; monthly seasonality needs more history than most workspaces have — it activates automatically at 26+ weeks of data, and evidence copy says which mode is active).
- **`anomaly(metric)`** → deviation beyond k·MAD sustained ≥ N periods (both thresholds rules-as-data per metric class, D6). Sustained, because single-day blips generate noise Actions and noise Actions burn trust (R6). Exception: a small set of `acute` metrics (index coverage collapse, traffic → ~0) alert on first observation — these are the rule-gated urgent interrupts of ADR-014.
- **`changepoint(metric)`** → simple two-window comparison (trailing 4w vs prior 4w, MAD-scaled) to label metrics `improving | stable | degrading`. Deliberately not a fancy changepoint algorithm: explainability beats sensitivity here, because every label must survive the evidence drawer ("degrading: −23% vs prior 4 weeks").
- **Confound awareness (cheap but crucial):** the service maintains a workspace **event register** — deploys (ForgCV webhook), published posts, completed Actions, experiment starts, Google algorithm-update dates (curated global KB) — and every anomaly is annotated with co-occurring events. This is the difference between "traffic dropped, investigate" and "traffic dropped two days after the June core update" — the second is an expert, the first is a smoke detector.

All tier 0–1. **LLM budget: €0.**

## 2. The Growth Model (8.2) — one funnel, computed daily

```sql
growth_model_snapshots (
  workspace_id, computed_on date,
  funnel jsonb,      -- per stage: {value_7d, value_28d, baseline, trend, data_quality}
                     -- stages: traffic → signup → activation → revenue → retention → referral
  channels jsonb,    -- per channel: efficiency ledger summary (8.3)
  bottleneck jsonb,  -- detector output (8.4): {stage, reason, confidence, evidence[]}
  focus jsonb,       -- weekly focus (8.5), sticky: {value, focus_locked_until, focus_changed_by, focus_change_reason} — focus-change history is a strategy signal, not an error
  data_coverage jsonb, -- which stages have real data vs none (honesty layer)
  PRIMARY KEY (workspace_id, computed_on)
)
```

- Funnel stages map to the five Core Principle metrics; sources: GA4 (traffic), ForgCV events (signup→referral). **`data_quality` per stage is first-class:** a stage fed by 30 events/week is labeled low-quality and the model *says so* rather than trending noise. A stage with no source (no ForgCV connection) is `no_data` — and produces exactly one prerequisite Action, not a hole silently papered over.
- Snapshots are kept (cheap, one row/day) — trends of the model itself power the weekly review ("activation improved for the 3rd consecutive week") and the monthly track-record moment.
- Recompute: daily scheduled job after ingestion settles; on-demand recompute triggered by acute anomalies only.

## 3. Channel Efficiency Ledger (8.3)

Per channel (organic, LinkedIn, Reddit-later, referral, direct): sessions → signups → activations attributed via UTM/source (ADR-020 pays off here — our own tags make this table possible without any platform's cooperation), plus **effort accounting**: completed Actions' `effort_minutes` per channel. Output: a modest, honest efficiency view — *signups per hour of founder effort per channel*, labeled with n and marked `directional` below data floors.

This ledger is what makes the founder's earlier instinct ("in this workspace, SEO currently produces more results") a computed fact: it feeds `origin_track_record`'s channel-level cousin in arbitration, and it's the evidence behind reallocation suggestions ("your last 10 LinkedIn hours produced 2 signups; your last 4 SEO hours produced 19 — this week's focus reflects that").

## 4. Bottleneck Detector (8.4) — theory of constraints, applied

The engine's centerpiece, and deliberately simple:

1. Normalize each funnel stage's conversion against **stage-appropriate reference bands** (global KB, curated, labeled by epistemic level — "SaaS landing→signup commonly 2–8%" is an *observation*, never a law) and against the workspace's own trend.
2. Score each stage: `severity = gap_vs_own_trend + gap_vs_reference_band (only where data_quality permits) × downstream_leverage` — where downstream_leverage encodes the obvious-but-ignored truth that fixing activation multiplies every upstream win, while pouring traffic onto a leaking signup step wastes founder hours.
3. Emit **one** bottleneck (plus runner-up, internal). One — because "your constraint is activation" is a decision aid; a ranked list of five constraints is a dashboard wearing a costume (P1).
4. The bottleneck writes into arbitration's `goal_alignment`: Actions targeting the bottleneck stage get a bounded multiplier. Bounded (cap 1.3× — founder-ratified; a bottleneck is an intelligent hypothesis, not a truth), because the detector can be wrong, and a wrong bottleneck must bias the feed, not dictatorially rewrite it.
- Cold start / sparse data: below data floors the detector abstains — `bottleneck: {stage: null, reason: 'insufficient_data', next: 'connect GA4' | 'accumulate 3 more weeks'}` — and the focus selector falls back to Strategy Profile's declared goal. **Abstention is a feature**; a fabricated bottleneck would corrupt a week of the user's effort.

## 5. Weekly Focus Selector (8.5)

Monday's job composes: bottleneck (if confident) → else Strategy Profile goal → shaped by channel efficiency + any running experiment's needs. Output: the one-line focus the Today header and digest carry all week ("Focus this week: activation — signup→first-CV completion dropped to 31%"). Sticky for the week — a focus that changes daily isn't a focus. Mid-week override only by acute anomaly (rule-gated, rare by construction).

The focus is also **the user's steering wheel**: it's shown as editable ("this week I'd rather push content") and an edit is recorded as a strategy signal (feeds affinity/goal weighting), not fought. The system proposes; the founder disposes — same posture as everywhere else in the product.

## 6. Cadence & Cost Summary

| Job | Cadence | Tier | LLM cost |
|---|---|---|---|
| Baselines + anomalies | daily (hourly for `acute` set) | 0–1 | €0 |
| Growth model snapshot | daily | 1 | €0 |
| Channel ledger | daily | 1 | €0 |
| Bottleneck + focus | weekly (Mon), acute-triggered rarely | 1 | €0 |
| Weekly review narrative | weekly | 4 (short, template-framed) | ~€0.01–0.02/ws/mo |

The entire analytical brain runs at effectively zero marginal LLM cost — which is exactly what D3 predicted a disciplined design would look like: the *thinking* is deterministic; the model only narrates once a week. (The deferred daily "Growth Coach" synthesis now has a natural home if it ever earns its cost: it would read this engine's output. Still deferred, per Section 4 §10.)

## 7. Architecture Review Delta (v0.8)

**New ADRs:**
- ADR-022: One shared baseline/anomaly service (median+MAD, day-of-week adjustment, sustained-deviation rule); pipelines forbidden from private baseline definitions.
- ADR-023: Growth Model as daily computed state with per-stage `data_quality`; bottleneck detector abstains below data floors; bottleneck bias in arbitration bounded at 1.3× (founder-amended from 1.5×).
- ADR-024: Workspace event register for confound annotation (deploys, posts, actions, experiments, curated algorithm-update dates).

**New risks:**
- R22: Reference bands (global funnel benchmarks) risk false authority → curated KB only, epistemic labels rendered, used only where workspace data_quality is low, never presented as targets.
- R23: Bottleneck detector wrong → bounded influence + weekly (not daily) cadence + user-editable focus + abstention path.

**Open questions for founder:**
1. Reference-band sourcing: curate a small starter set ourselves (my recommendation — ~20 well-sourced bands for our persona's funnel, reviewed quarterly) vs licensing benchmark data (cost, dubious fit)?
2. Weekly focus: confirm user-editable (my recommendation) vs system-fixed?
3. Ratify that Section 8's scope as claimed here replaces any future re-specification of pipeline internals or scoring — Sections 4/16 remain the owners of those.
