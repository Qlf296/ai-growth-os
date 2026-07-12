# AI Growth OS — Section 15: AI Memory System

**Status:** Proposed v1 — pending founder review
**Maturity-rule compliance:** this section creates almost nothing. Its job is to name, map, and gap-check the memory system that Sections 3–12 already built piece by piece — and to close the one genuine gap found (cross-workspace learning boundary, §3). One boundary ADR; zero new mechanisms.

---

## 1. The Memory Map (what already exists, named as a system)

"AI memory" here is not a vector store bolted onto a chatbot — it is eight typed stores, each with a single writer, a governed read path, and a decay/deletion rule. That table *is* the memory architecture:

| Memory type | Store | Writer (single) | Decay | Deletion (GDPR) |
|---|---|---|---|---|
| **Declared** — who the founder is, what they want | Strategy Profile (ADR-010) | the user (+ system proposals, user-confirmed) | none; user-maintained; overrides logged as strategy signals | with workspace |
| **Stylistic** — how they write | Voice Profile (ADR-027) | edit-diff learner; user-correctable (Settings page) | refreshed by each publication | with workspace |
| **Learned (workspace)** — what works *here* | workspace KB (ADR-012) | Learning Propagator only (ADR-035) | epistemic level × freshness (ADR-039, `freshness_source`) | with workspace, incl. embeddings |
| **Curated (global)** — what the field knows | global KB + benchmark_sources | curation process, provenance-first | freshness sweeps; quarterly review | n/a (no personal data) |
| **Behavioral** — what this founder responds to | category affinities, track records, effort-fit | nightly recompute from action_events | recency-weighted by design (founder's reason-weighted formula) | with workspace |
| **Episodic** — what happened when | event register (ADR-024) + signals/rollups | ingestion + system events | retention/rollup policy (ADR-002) | with workspace |
| **Decisional** — why the system chose | decision traces (ADR-044) + ledgers | assembled at generation | retention policy; append-only | anonymized per ledger rules |
| **Institutional** — how the system is tuned | config registry (ADR-046) + rules + playbooks | governed change process | `stability` lifecycle; versioned forever | n/a |

Properties the map makes visible: every store has **one writer** (the pattern ADR-035 established, generalized); nothing is remembered without provenance; everything personal dies with the workspace; and "the AI's memory" is **inspectable by the user** wherever it's about them (Strategy Profile, Voice Profile, Learnings surface, notification/auth history) — memory transparency is already a product feature, not an aspiration.

## 2. What Is Deliberately Not Remembered

Stated once, as product law application rather than new rules: no conversational memory (there is no chat surface to remember — the product's interface is decisions, not dialogue); no cross-workspace voice or content data (ADR-027); no profiles of third-party humans (ADR-038); no stale knowledge used as strong evidence (ADR-039); no memory the user cannot see, correct, or delete where it concerns them (GDPR + Constitution). Forgetting is implemented, not promised: deletion cascades (Section 3 §2), freshness decay, KB pruning by `use_count`, retention rollups.

## 3. The One Genuine Gap — Cross-Workspace Learning (policy extension to ADR-012/039 — **not** a new ADR, per founder ruling)

Section 5 already showed the ambition in passing: *"heuristic — observation from 12 workspaces."* Nothing yet governs how such an observation may be produced. The founder's review correctly caught my over-reach: every mechanism involved already exists (global KB, ADR-039 freshness, ADR-035 evidence, ADR-012 promotion, ADR-033 grades) — so this is a **governance policy attached to existing ADRs**, recorded as the "Cross-workspace aggregation policy" subsection of ADR-012, cross-referenced from ADR-039. The Section-13 promise (no new ADRs without absolute necessity) holds:

- **What may cross workspaces:** aggregated statistical observations only — taxonomy-cell performance ratios, timing-slot effects, detector success rates — computed over ≥ k workspaces — **k = 25** (founder-raised from 10; stronger statistically and for GDPR posture), held as `minimum_population_for_global_observation` in the config registry (ADR-046) — no magic numbers in code — with no workspace distinguishable, published into the global KB as `observation` with `population: n` and `freshness_source: verified_by_outcome`.
- **What may never cross:** content (posts, drafts, pages, queries), Voice Profiles, Strategy Profiles, competitor sets, community lists, identities, or any per-workspace metric — raw or lightly aggregated. The aggregation job reads graded verdicts and taxonomy cells, never artifacts.
- **Consent posture:** contribution to aggregates is covered in the privacy policy and **opt-out-able per workspace** (Settings toggle); opting out never degrades the workspace's own learning (its KB is untouched) — it only abstains from the commons. EU-clean: anonymous statistics, k-thresholded, no re-identification surface.
- **Honesty rendering (already law):** global observations display their population and epistemic level, are freshness-governed like everything else, and are always outranked by mature workspace-local learnings (specific beats general — the resolution order Section 3 §8 fixed).

## 4. Delta

**New:** Cross-workspace aggregation policy under ADR-012 (§ added) + ADR-039 cross-ref: k≥25 (config-governed), statistics-only, opt-out-by-workspace, local-beats-global, aggregates capped at `observation` — *"the Global KB never produces truth; it produces observations, trends, hypotheses"* (founder wording, adopted verbatim as the policy's epigraph). **No new ADR.** **New risk R32:** aggregate quality skew (early adopters unrepresentative) → populations displayed, `observation` ceiling until diverse n, never `validated` from aggregates alone.
**Open questions — resolved by founder:** k=25, config-governed ✓ · opt-out default (anonymous statistics only cross) ✓ · aggregates permanently capped at `observation`; validation only from workspace evidence or high-quality external research ✓.
