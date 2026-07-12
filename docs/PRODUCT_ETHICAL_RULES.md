# PRODUCT_ETHICAL_RULES.md — AI Growth OS

**Status:** Ratified by founder — **Product Constitution**
**Priority order (founder-ratified):** 1. Security · 2. GDPR/Privacy · 3. PRODUCT_ETHICAL_RULES · 4. ADRs · 5. Features. A feature that violates a law does not ship.
**Reference:** ADR-029 · This document is permanent. Amendments require explicit founder ratification and a recorded rationale. Every feature, pipeline, prompt, and UI copy review checks against this list. A feature that cannot be built without violating a rule below does not get built.

---

## I. Content & Drafting Laws

1. **No fabricated personal stories.** The system never invents an experience, anecdote, or opinion and attributes it to the founder. Drafts may only build on material the founder provided or published.
2. **No fake testimonials or social proof.** Never generate, imply, or embellish user quotes, numbers, or endorsements that do not exist in verifiable data.
3. **No engagement bait.** No manipulative curiosity gaps, outrage farming, false scarcity, or dark-pattern hooks. Persuasion is legitimate; manipulation is not. (Enforced at the taxonomy level: no bait patterns in `hook_type`, and at tier-3 draft checks.)
4. **No hidden promotion.** Where a community expects disclosure of affiliation, drafts disclose it. Community playbooks encode the norm; the rule holds even where a playbook is silent and doubt exists.
5. **No publishing without human confirmation.** The system drafts; the human publishes. API-publish, where offered, is an explicit per-post human choice. There is no autopilot for content. (Any future automation proposal — Section 14 — must argue against this rule in writing, before a founder decision.)

## II. Epistemic Laws

6. **No pretending to know unavailable metrics.** If a platform does not expose a number, the product says so. Estimates are labeled estimates; absences are labeled absences.
7. **No hypothesis dressed as fact.** Epistemic levels (hypothesis / observation / validated) render wherever knowledge is shown, with `n` where applicable. Promotion between levels follows hard criteria (ADR-012), never copywriting.
8. **No interpretation replacing measurement** (ADR-025). Every claim must survive "why do you believe that?" with data references. Abstention ("not enough data yet") is always preferred over fabricated confidence.
9. **No fake precision.** Confidence is High/Medium/Low, never invented percentages. Impact is tiered, never predicted point values without a real model behind them.
10. **No invented business value.** *(Law 15 in founder numbering)* The system never converts traffic, clicks, or engagement into money without verified revenue attribution. Measured units until revenue events make real attribution possible (ADR-034).

## III. User-Respect Laws

11. **No guilt mechanics.** No streaks, no "you missed…", no shame copy, no red-badge farming. The notification budget (ADR-014) is the enforcement mechanism.
12. **No dark patterns in the product itself.** Cancellation, data export, deletion, and disconnection are as easy as their opposites.
13. **Dismissal is data, not disobedience.** The user overriding the system (dismissals, focus changes, edits) is recorded as signal and respected — never fought, never nagged.
14. **Human ownership of growth decisions.** *(Law 16 in founder numbering)* The system may analyze, explain, and suggest. The founder owns the decision. AI is the analyst; the human is the strategist — never a CEO replacement.

## IV. Platform & Community Laws

15. **No ToS violations, no scraping around API limits.** Capability limits are designed around honestly (ADR-020) — never circumvented.
16. **Community reputation over reach.** Participation caps, etiquette playbooks, and removal-triggered pauses (ADR-028) bind all community features. The user's standing in their communities outranks any growth metric.

---

*Mapping:* Laws 1–5 = ADR-029 · 6–10 = D2, ADR-008, ADR-012, ADR-025, ADR-034 · 11–14 = ADR-014 + UX decisions + founder Law 16 · 15–16 = ADR-007/020/028. Founder numbering: "Law 15" = №10 here (No invented business value), "Law 16" = №14 (Human ownership). This file collects them so no future section, contributor, or model rewrite can "forget" one.
