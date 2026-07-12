# DECISION_LIFECYCLE.md — AI Growth OS

**Status:** v2.1 process doc. **Purpose:** prevent the failure mode where someone edits an ADR directly to change an important rule. ADRs are the *output* of this pipeline, not an editable config.

```
Idea            informal — anyone, anywhere
  ↓
RFC             short written proposal: problem, options, recommendation,
                which invariants/ADRs/laws it touches
  ↓
ADR draft       decision + context + alternatives + trade-offs + migration path
  ↓
Shadow eval     MANDATORY if decision-affecting (weights/thresholds/rules — ADR-045);
                skipped only for non-decision changes (UI, perf, bugfix)
  ↓
Ratification    founder decision, recorded (this project's reviews ARE this step)
  ↓
Frozen          ADR enters the index; config lands in registry with stability tag
```

Rules:
- **Touching an invariant (SYSTEM_INVARIANTS.md) is the heaviest class** — requires explicit acknowledgment that an invariant changes, plus full lifecycle. Not doable in a quiet PR.
- **Touching the Constitution (PRODUCT_ETHICAL_RULES.md)** ranks above ADRs — same weight as an invariant change.
- **`experiment`-tagged config** (ADR-046) may move faster (that's its purpose) but graduation to `stable` requires shadow-eval evidence.
- No ADR is edited to change a rule; a new ADR supersedes it, and the index records the supersession. History is append-only, like everything else in this system.
