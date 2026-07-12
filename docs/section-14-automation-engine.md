# AI Growth OS — Section 14: Automation Engine

**Status:** Proposed v1 — pending founder review
**Depends on:** Product Constitution Law 5 (no publishing without human confirmation) & Law 16 (human owns decisions), Action lifecycle (ADR-006/Section 3 §6), R9 (prompt-injection boundary), ADR-046 (config), ADR-047 (observability), legal_consents pattern (Section 6)
**Constitutional obligation:** the Constitution requires any automation proposal to **argue against Law 5 in writing before a founder decision.** That plea is §2 of this document — presented at full strength, then ruled on. Everything else in the section is composition of existing mechanisms, per the maturity rule.

---

## 1. What "Automation" Already Means Here (no Law-5 contact)

Most of this product *is* automation, none of it controversial: ingestion, normalization, the intelligence ladder, arbitration, outcome evaluation, KB maintenance, freshness sweeps, digest assembly, retries, reprocessing. All system-side, all observable (ADR-047), all budgeted. This section adds nothing to them — they're listed to make the boundary sharp: **the only automation question that matters is side effects in the outside world** (publishing, sending, modifying the user's properties). That's where Law 5 lives.

## 2. The Plea Against Law 5 (presented at full strength, as required)

*The case an automation advocate would make:*

1. **Friction costs compound.** A founder who approves a weekly post series still must be present at each optimal publishing moment. Tuesday 9:00 is the best slot precisely when the founder is in a stand-up. Law 5 as written makes the system's own timing intelligence partially unusable.
2. **Confirmation fatigue degrades judgment.** Forty near-identical title-fix confirmations don't produce forty considered decisions; they produce reflexive clicking. A scoped mandate ("apply title fixes of this pattern") could be *more* deliberate than the fortieth click.
3. **Competitors will automate.** Tools that post, reply, and fix autonomously will demo better. "Set and forget" sells.
4. **The human remains in control via revocation.** A kill switch plus caps plus audit trail arguably preserves Law 16's spirit — ownership through oversight rather than through per-act clicking.

*The ruling this section recommends:*

Points 3 and 4 fail on our own terms: (3) is an argument about demos, not about user outcomes — and our positioning is precisely *copilot, not autopilot* (founder, Section 7); (4) confuses *ability to stop* with *ownership of the act* — Law 16 assigns the decision, not merely a veto. Point 2 is real but is an argument for **better batching UX** (one screen, ten diffs, one considered approval of the batch — each artifact still human-seen), not for removing the human. Point 1, however, identifies a genuine gap — and it's resolvable **without breaching Law 5**, because Law 5 governs *confirmation*, not *execution timing*:

> **A human who approves the exact, frozen artifact has confirmed it. Executing that confirmed artifact at a scheduled time is delegation of clockwork, not of judgment.**

## 3. The Automation Ladder (ADR-048 — a boundary ruling, justified under the maturity rule)

*Why this is an ADR despite the moratorium: it introduces no new mechanism — every rung composes the existing Action lifecycle, consents, config, and ledgers. What it fixes permanently is a **boundary**: where, on the ladder, this product stops. Boundary rulings are exactly what ADRs are for.*

| Rung | Description | Status |
|---|---|---|
| A0 Manual | user does everything | always available |
| A1 Assisted | draft + deep link, human publishes | **launch default** (unchanged) |
| A2 Confirmed-scheduled | human approves the **exact frozen artifact**; system executes at the approved time | **permitted** — Law-5-compatible per §2's ruling |
| A3 Conditional (rule mandates: "auto-apply X-pattern changes") | human approves a *class*, system creates instances | **forbidden for content & outreach**, indefinitely; conceivable someday only for reversible technical ops behind a dedicated review |
| A4 Autonomous | system decides and acts | **constitutionally forbidden** (Laws 5, 16) |

**A2 mechanics (all existing machinery):** approval freezes `content_hash` + target + time into the Action (`approved_scheduled` — one new lifecycle state, ADR-006 extension); a signed execution record (consent-pattern from Section 6) captures who approved what and when; execution verifies the hash — **any change after approval voids the schedule** and returns the Action to draft (this is also the R9 answer: ingested content cannot influence an executed artifact, because the artifact is frozen at human approval — the injection window is closed by construction); per-workspace scheduled-execution caps in config; a global and per-connection kill switch (`pause all scheduled executions`) one tap deep in Settings; failures route through Section 13 rules (digest by default; interrupt only if it blocks active work); every execution lands in the audit log + decision trace.

**What A2 covers at launch of this capability (Phase 2, with LinkedIn API-publish opt-in):** scheduled publishing of approved posts. **What it deliberately does not cover:** replies in communities (context can shift between approval and posting — a thread can turn; community actions stay A1), outreach/DMs (A1 forever at minimum), and any destructive operation.

## 4. Non-Content Automation Requests (the honest catch-all)

Future asks will come ("auto-fix my metas", "auto-update sitemaps"). Standing disposition: each is evaluated as A2 if the artifact can be frozen and shown ("here are the 10 exact meta changes — approve the batch"), A3-forbidden if it can't. The batch-approval UX from §2's point-2 rebuttal is the designed pressure valve — it removes 90% of the friction that makes people ask for A3, at zero constitutional cost.

## 5. Cost, Phasing, Delta

A2 ships Phase 2 (needs LinkedIn API-publish, already opt-in-designed in Section 7). LLM cost: €0 (execution is clockwork). Footprint on the referential: **one ADR (048, boundary ruling), one lifecycle state (`approved_scheduled`), zero new concepts** — mandates are consents, schedules are config+jobs, safety is hashing+existing ledgers.
**New risk R31:** approved-content staleness — a post approved Monday may be contextually wrong Thursday (news events). Mitigation: schedule horizon cap (config, proposal: 7 days max between approval and execution) + one-tap unschedule from Today.
**Open questions for founder:**
1. Ratify the §2 ruling and ADR-048's ladder — specifically that A3 is forbidden *indefinitely* for content/outreach (my recommendation: yes; revisiting would require amending the Constitution's Law 5, deliberately heavy).
2. Schedule horizon cap: 7 days (my proposal) or shorter?
3. Confirm community replies stay A1 permanently (my recommendation — threads shift; the copilot reads the room *with* the human, not for them).
