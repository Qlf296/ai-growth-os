# Phase 7 Architecture Report — AI Growth OS

**Date:** 2026-07-12 · **Referential:** v2.1 (frozen) · **Scope:** Automation & Experiment Engine · **Status:** complete, all gates green, working tree clean. Describes the current implementation only.

## 1. Executive summary
Phase 7 adds bounded automation and an A/B experiment engine that close the growth loop while honouring the frozen referential. A new `@aigos/automation` package provides data-driven automation rules (triggers/conditions/actions as data), an action registry that structurally forbids publishing, an idempotent queue-integrated executor, human-configured auto-acceptance of recommendations, and a full experiment lifecycle with deterministic assignment and evaluation. Seven steps (7.1–7.7), one green commit each, tests-first. Suite grew from 291 to **294 tests** (many multi-assertion); architecture tests and CI gates green throughout. A single end-to-end test exercises Signal → Detection → Growth → Recommendation → Draft → Automation → Experiment → Evaluation.

## 2. Automation model
Triggers, conditions and actions are data. A condition is a deterministic AND of typed clauses (eq/neq/gt/gte/lt/lte/in) over a flat fact. A trigger is a type plus an optional filter. Rules carry a ladder level, enabled flag and `created_by` (the human who configured them). The executor matches trigger + condition, enforces the ladder, runs the action via the registry and captures errors — never throwing.

## 3. Automation ladder & Law compliance
The ladder is bounded to A0–A2 (ADR-048); A3/A4 are forbidden — enforced by a DB CHECK and by the executor. The action registry refuses to register any action that declares `publishes: true` (Law 5). Auto-acceptance advances only the opportunity lifecycle (validate → accept) by executing rules a human configured in advance (Law 16 — the human owns the decision; the rule is their standing order). No automation publishes or sends.

## 4. Experiment Engine
Experiments have a lifecycle (running → completed → archived), ≥2 variants, deterministic per-unit assignment (pure hash of experiment|unit → variant, persisted once, stable on replay), and metrics. Evaluation picks the variant with the highest mean of the experiment metric; ties resolve to control (conservative rollback). Outcome is `promotion` (treatment wins) or `rollback` (control wins/tie). Every transition and evaluation is audited.

## 5. Scheduler/Queue integration
`runAutomationForEvent` loads a workspace's enabled rules, evaluates them and persists each outcome to `automation_executions` idempotently (UNIQUE workspace+rule+trigger_ref). The worker `createAutomationHandler` runs on the existing queue (retries/backoff/DLQ reused); already-executed rules are skipped, so retries and replays never double-execute.

## 6. Recommendation execution & hooks
Built-in non-publishing actions (`opportunity.validate`, `opportunity.accept`) reuse the growth lifecycle (`transitionOpportunity`) — no duplicated workflow. `emitOpportunityEvent` builds the fact from the opportunity row and runs the workspace's rules idempotently (trigger_ref = opportunityId:triggerType). Evidence ids are carried into every execution result (I4 linkage).

## 7. Automation dashboard & experiment pages
`/automations` renders the rules table and the execution history timeline; `/experiments` renders real experiments grouped by state (running/completed/archived) with variants, mean metrics and winner. Both read repository views only.

## 8. Database changes
Migration 0013: `automation_rules` (data-driven, ladder CHECK A0–A2, created_by human) + `automation_executions` (idempotent history). Migration 0014: `experiments`, `experiment_variants`, `experiment_assignments` (UNIQUE per unit), `experiment_metrics`. All RLS ENABLE+FORCE and workspace-scoped; histories append-only.

## 9. New migrations
`20260712000013_automation`, `20260712000014_experiments` — expand-only, each with NOTES (Rollback/Backfill). Pass the ADR-043 gate.

## 10. Package changes
New `@aigos/automation` (depends on `@aigos/{database,growth}` + `pg`). `apps/worker` and `apps/web` depend on it. No new external production dependency.

## 11. ADR compliance
ADR-048 (ladder bounded to A2; A3/A4 forbidden), Law 5 (no auto-publish — structurally enforced), Law 16 (automation executes only human-configured rules), ADR-031/growth lifecycle reuse, ADR-035/I4 (evidence linkage), ADR-003 (queue/scheduler reuse), ADR-043 (expand-contract migrations), ADR-047 (automation metrics).

## 12. Invariants verified (I1–I14)
I5 (single writer per store — automation/experiment writers are the only writers of their tables), I9 (RLS on all new tables — leak-tested), I4 (evidence carried through automation results), I10/Law 5 (no side effect without a human — nothing auto-published; verified in the e2e). Determinism/replay: condition evaluation, experiment assignment and evaluation are pure and reproducible. AT-boundaries/AT-6/AT-7 green.

## 13. Test summary
23 new tests: automation model/registry/executor (7), experiment lifecycle (4), queue integration/idempotency (4), recommendation auto-execution (4), evaluation (4), plus dashboard (3) and the full end-to-end scenario (1). Total suite 294/294; architecture tests 0 violations; all CI gates green.

## 14. Performance review
All automation/experiment logic is pure arithmetic or single indexed writes; idempotent inserts avoid amplification under retry/replay. No LLM in automation. Experiment assignment is O(1) hash; evaluation is one grouped aggregate.

## 15. Technical debt
Automation is currently invoked via explicit hooks/handlers; wiring domain events (opportunity created/validated) to enqueue automation jobs fleet-wide is not yet automatic. The automation dashboard is read-only (no rule editor UI yet). Experiment metric ingestion is manual (`recordMetric`); connecting it to measured outcomes (Analytics) is Phase 8. Carried: real ModelProvider/transports fixtures-only in CI; `@prisma/client` devDep reclassification.

## 16. Remaining work
Auto-enqueue automation on lifecycle events; rule-editor UI (owner-gated); connect experiment metrics to measured outcomes and the Learning Propagator; surface promotion/rollback decisions in Today.

## 17. Phase 8 entry points
The loop is now mechanically complete end-to-end. Phase 8 (Analytics & Learning) can measure outcomes against opportunity/experiment success criteria (grades A–F, ADR-033), feed results into detector/priority/experiment weights via the Learning Propagator, and deliver the daily digest (I7, ADR-014) so the human closes the loop with real results in view.

---
*Generated at the end of Phase 7. Describes the implemented system only; no future features invented.*
