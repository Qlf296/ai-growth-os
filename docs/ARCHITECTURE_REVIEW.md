# AI Growth OS — Architecture Review v2.1 (FINAL — FROZEN)

**Status:** Frozen referential. Amendments henceforth require: a founder-ratified ADR, a recorded rationale, and — where decision-affecting — shadow evaluation (ADR-045). This document is the entry point; the 20 section documents + PRODUCT_ETHICAL_RULES.md are the referential's body.
**Reading order for a newcomer:** §1 Principles → Product Constitution → §2 System shape → section docs as needed → §3 ADR index for any decision's provenance.

---

## 1. Permanent Principles (each mapped to concrete enforcement — checklist item 3, verified)

| ID | Principle | Concretely enforced by (samples) |
|---|---|---|
| P1 | Action First — features must reduce decision effort | No-Analytics-tab (S5, founder-ratified) · reports as documents-not-destinations (S17) · one-bottleneck rule (S8) |
| P2 | Evolution over complexity; triggers before replacements | Trigger table S19 §3 (single source) · ADR-018 documented-not-built invitations · no-ADR-049 ruling (S15) |
| P3 | Tiered intelligence; frontier calls scarcest | ADR-009/011 · Gateway budgets · €0-LLM decision core (S16) · launch COGS €0.15–0.35/ws |
| P4 | Priority: Correctness > Security > Privacy > Constitution > Scale > Maint. > Perf > UX > Speed | S19: perf may never change ranking (replay-tested) · S18 threat model rank |
| P5 | Honest epistemics — measurement ≠ interpretation; abstention over fabrication | ADR-025/033/035/039 · epistemic levels · labeled exploration (S16) · "not yet measured" revenue (S17) |
| P6 | Human owns the decision (Law 16) | ADR-048 ladder (A3 forbidden for content) · draft-and-confirm everywhere · user-editable focus |
| P7 | ForgCV-first, never special-cased | forgcv.internal adapter (S7) · no `if (forgcv)` (lint-able) · MVP gate = "runs ForgCV's growth for real" (S20) |

## 2. System Shape (final)

Modular monolith (TS end-to-end; web + worker), single Postgres + pgvector + RLS, Redis (cache/queue, non-durable), S3 raw-first store, one AI Gateway (sole model path, budgets, cache, template versions), adapters behind capability manifests, Action as central entity with full lifecycle and decision traces. Flow: `Signals → Growth Intelligence (state) → Pipelines (opportunities) → Recommendation Engine (S16: gates → score → arrange → commit) → Today (human) → Analytics (graded verdicts) → Learning Propagator (KB/weights) → better next feed.` Eight typed memories, one writer each (S15). Delivery as sole sender (S13). Everything tunable lives in the config registry; everything decision-affecting is shadow-evaluated; every decision and claim is traceable to rows.

## 3. Definitive ADR Index (001–048 — all consumed; checklist item 1 verified: no orphan ADRs)

| ADR | Decision | Consumed by |
|---|---|---|
| 001–005 | Monolith/TS · Postgres+pgvector · queue/scheduler · pipelines-not-agents · managed infra | every section; 004 held at S4/S9/S16 |
| 006–009 | Hybrid state · capabilities-as-data · evaluable criteria+baseline-at-creation · free tier = tiers 0–2 | S11, S7, S16 gates, plans |
| 010–013 | Strategy Profile · T4 on-accept · experiment guard+evidence strength · bounded learned arbitration | S16 (definitive assembly), S4, S8 |
| 012+ | Cross-workspace aggregation policy (k≥25 config, stats-only, opt-out, `observation` cap) | S15, Phase 3 |
| 014–015 | Notification budget · GSC-first onboarding | S13 (registry+mechanics), S5 |
| 016–019 | Passwordless · server sessions · Model-A-on-B · workspace-owned connections+authorized_by | S6, S18 threat model |
| 020–021 | UTM measurement independence · adapter contract | S7/S8/S9/S11 — the loop's floor |
| 022–025 | Shared baselines (maturity, `baseline_status`) · Growth Model+1.3× cap+abstention · event register · interpretation ≠ measurement | S8/S10/S11/S16 |
| 026–029 | Taxonomy · Voice Profile (no fine-tune, visible) · playbooks+reputation · ethical perimeter → Constitution | S9, S13, Laws 1–5 |
| 030–032 | Workspace CTR curve · one-page-one-action · own-site crawler Ph2 | S10, S16 grouping |
| 033–035 | Grades A/B+/B/C/F · honest ROI (Law 15) · single Evidence Generator + evidence_reference_id (incl. comparative claims) | S11/S17 — reproducible reports |
| 036–038 | Nominated competitors · polite observation protocol · facts-not-profiles, no estimates | S12 |
| 039–043 | Freshness+decay+`freshness_source` · feature kill · capability registry · detector health · schema evolution | S15/S16 gates, ops reviews |
| 044–047 | Decision traces (+prompt_template_version) · scoped replay/shadow-eval (mandatory for decision-affecting changes) · config-as-data (+stability) · observability contract (+SLO owners) | S16/S18/S19 — the governance triad |
| 048 | Automation ladder: A2 permitted (frozen artifact), A3 forbidden for content/outreach, A4 constitutionally forbidden | S14, R9 containment |

**Checklist item 4 (verified):** all decisional tunables route through ADR-046 (S16 §7 lists the keys; S13 cooldowns; S8 thresholds; S19 SLO thresholds); all decision-affecting changes gated by ADR-045 (S16 §5 places the gate).

## 4. Product Constitution (16 laws)

See PRODUCT_ETHICAL_RULES.md — rank: Security > GDPR > Constitution > ADRs > Features. Notables: Law 5 (no publishing without human confirmation — ruled on in S14), Law 15 (no invented business value — extended to third parties in S12), Law 16 (human ownership). **Checklist item 6 (verified):** every entry in the S20 Deferred/Refused register cites its deciding section/ADR/Law.

## 5. Final Risk Register (every risk: mitigation + owner — checklist item 2 verified)

| Risk | Status | Owner (module) |
|---|---|---|
| R1 platform APIs | designed-around (ADR-020, capabilities, partner app filed) | Connections/Ingestion |
| R2 monitoring cost | mitigated (plan-tiered polling, retention, ws-as-cost-unit) | Billing+Ingestion |
| R3 cold start | mitigated (ADR-015, abstention, labeled heuristics, exploration) | Recommendation |
| R4 token custody | **standing-critical**, fully mapped (S18 §2 rows 1–3, revoke-first runbook) | Connections (vault) |
| R5 LLM cost | closed (ladder+budgets; flat COGS S19 §5) | AI Gateway |
| R6 rec fatigue | mitigated (caps, affinity, diversity, health) | Recommendation |
| R7 tier false-negatives | mitigated (shadow sampling → ADR-042 metric) | Intelligence |
| R8 staleness | closed (invalidation + ADR-039) | KB |
| R9 prompt injection | **contained-by-architecture** (S18 §3; re-review triggers named) | AI Gateway |
| R10–11 provider outage / runaway spend | mitigated (failover; hard budgets, model-ops row S18) | AI Gateway |
| R12–13 LinkedIn perception / attribution noise | mitigated (honest copy) / closed (grades) | Delivery / Analytics |
| R14–16 community rep / KB corruption / SERP cost | mitigated (playbooks+caps / epistemic+grade-A / keyword caps) | Community / KB / Billing |
| R17–19 stale feed / FR-EN / magic-link deliverability | mitigated | Recommendation / Delivery / Identity |
| R20–21 OAuth paperwork / Reddit terms | tracked (Phase-0 parallel task; degradation path) | Ops / Ingestion |
| R22–23 benchmark authority / wrong bottleneck | mitigated (provenance; 1.3×+abstention+editable focus) | KB / Growth Intelligence |
| R24–27 voice creep / community misread / JS crawl / GSC sampling | mitigated / accepted-with-degradation | Social / Community / SEO |
| R28 window drift | mitigated (retry + quarterly meta-review) | Analytics |
| R29–31 blocked watch / competitor-anxiety / approved-content staleness | accepted-honest / perimeter refusal / 7-day horizon cap | Competitor / Product / Automation |
| R32–34 aggregate skew / share-link leakage / restore failure | mitigated (populations+`observation` cap / signed+revocable / quarterly drills) | KB / Reporting / Ops |

## 6. Maturity-Rule Audit (checklist final item — per-section verification)

S13: 0 concepts, 0 ADRs ✓ · S14: 1 boundary ADR (048), justified — mechanisms all pre-existing ✓ · S15: 0 ADRs after founder correction (policy under 012/039) ✓ · S16: 0 — pure assembly, the keystone ✓ · S17: 0 — two report assemblies + one integrity rule under existing law ✓ · S18: 0 — threat model over existing decisions ✓ · S19: 0 — consolidation; supersedes S2 §15 table (pointer applied) ✓ · S20: 0 — synthesis + refusal register ✓. **Checklist item 5 (user-data CRUD):** the S15 memory map is the verification artifact — all eight memory types carry writer, read path, decay, and GDPR deletion; connections/tokens covered by ADR-019 + S18 §2; exports/deletion S6 §4. No uncovered store found.

## 6b. Governance Artifacts (v2.1 — enforcement layer)

Five companion documents turn the referential from prose into enforced constraint (founder v2.1 review):
- **SYSTEM_INVARIANTS.md** — 14 load-bearing invariants, ranked *above* ADRs, each naming its test.
- **ARCHITECTURE_TESTS.md** — the CI suite that fails the build on referential violations (single LLM path, single send path, token sacredness, tenant isolation, feed determinism, evidence-guarded claims, …).
- **DECISION_LIFECYCLE.md** — Idea → RFC → ADR → shadow-eval → ratification → frozen; ADRs are outputs, never directly edited.
- **PERFORMANCE_BUDGET.md** — per-segment budgets under each SLO; a consumed margin is a warning.
- **ADR_DECISION_TREE.md** — by-topic navigation over 48 ADRs.

These add no new architectural decisions; they make the existing ones enforceable by code and CI — the v2.1 mandate: *the architecture is applied by the build as much as by the documentation.*

## 7. Freeze Declaration

Referential v2.1 comprises: Sections 1–20 (as amended), PRODUCT_ETHICAL_RULES.md (Constitution, 16 laws), SYSTEM_INVARIANTS.md, ARCHITECTURE_TESTS.md, DECISION_LIFECYCLE.md, PERFORMANCE_BUDGET.md, ADR_DECISION_TREE.md, and this review. Every open question raised across twenty sections has a recorded founder decision; the Deferred/Refused register converts every "no" into a citable ruling. The referential's load-bearing property, stated once at the end as it was at the start: **the system's decisions are explainable, verifiable, and maintainable — by construction, not by intention.** Build Phase 0.
