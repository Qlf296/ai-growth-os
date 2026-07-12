# AI Growth OS — Section 13: Notification & Alert System

**Status:** Proposed v1 — pending founder review
**Depends on:** ADR-014 (budget — the philosophy, already law), Section 5 §3/§6 (digest & workflow), Section 6 (product_preferences, sending domains, R19), ADR-046 (all cadences/cooldowns as config), ADR-047 (internal observability — the *other* alert consumer)
**Maturity-rule compliance statement:** this section introduces **zero new fundamental concepts and zero new ADRs.** Everything below is delivery mechanics for decisions already ratified. Where a mechanism needed a home, it extends ADR-014. That is the inverted burden of proof, honored.

---

## 0. The One Diagram

```
Pipelines / Analytics / System        (may EMIT notification intents only)
            │
            ▼
   DELIVERY MODULE — sole sender (ADR-014 enforcement point)
   1. classify intent → type registry
   2. budget check (per type, per day, per workspace)
   3. dedupe + cooldown (config registry)
   4. batch or interrupt decision
   5. channel routing (email now, push Phase 2)
   6. render (Evidence Generator for any factual sentence)
   7. send + ledger
            │
            ▼
   notification_ledger (append-only)
```

No component sends anything directly — pipelines emit *intents*; Delivery decides if, when, how, and whether at all. An intent that dies against the budget dies silently and is ledgered as `suppressed(reason)` — suppression is observable (ADR-047), never mysterious.

## 1. Notification Type Registry (the whole taxonomy — deliberately short)

| Type | Trigger | Channel | Budget rule |
|---|---|---|---|
| `daily_digest` | morning, user-chosen time | email | 1/day, the anchor — most other content *rides inside it* |
| `urgent_interrupt` | tier-0 acute rules only (site deindexation signature, connection broken blocking active work, experiment post due today) | email now, push Phase 2 | ≤1/day, hard; bottlenecks can never trigger it (Section 8 rule) |
| `weekly_review` | Friday | email | 1/week |
| `outcome_reportback` | verdict lands | **batched into next digest** by default; grade-A `met` may render as its own digest headline | 0 standalone sends |
| `experiment_event` | start confirmed / result ready | digest-batched | 0 standalone |
| `security_transactional` | new device, email change, export ready, billing | email | exempt from budget (Section 6), never marketing |
| `account_lifecycle` | trial/plan/limits | email | minimal, no dark-pattern urgency (Law 12) |

Everything else that a growth tool would traditionally ping about — new recommendation available, "you haven't logged in", streak reminders, re-engagement campaigns — is **structurally impossible**: no type in the registry, no send path. Adding a type requires a founder-reviewed registry change, which is exactly the friction intended.

## 2. The Digest (the product's daily voice — spec'd once, here)

Analyst posture, per your Section 5 ratification. Assembly is deterministic (no tier-4 at launch — Section 4 §10 deferral stands):

```
Subject: Your 3 highest-impact growth actions today        ← template, localized FR/EN
─
Bonjour Halim,
Focus this week: Activation — signup→first-CV dropped 22%. ← Growth Model, evidence-ref'd
1. Rewrite the title of /cv-sans-experience  (~15 min)
   4,800 impressions, CTR 1.1% — half your median.          ← Evidence Generator sentences
   [Open action →]
2. …  3. …
Yesterday's result: /templates title change — CTR +38%,
target met ✓ (grade A).                                     ← report-back riding along
─
[unsubscribe digest] · [change time] · footer per GDPR
```

Rules: sender = **"AI Growth OS"** (founder-ratified: product voice, never a fake persona) · every factual sentence carries evidence refs (ADR-035, comparative claims included) · empty-ish days are honest ("2 actions today — a light day") rather than padded · digest send-time respects user TZ and the quiet-hours boundary · one tap from any item deep-links into Today with the action focused.

## 3. Mechanics (all values in config registry, per ADR-046)

- **"Digest wins" (founder reinforcement):** the channel hierarchy is structural — if a notification can reasonably wait for the next digest, it must: `weekly_review ← digest ← interrupt`, and eligibility for interruption requires failing the "can this wait until morning?" test, evaluated by rule. Interruption is thereby an exception by construction, not by restraint.
- **Content stability rule (founder reinforcement):** an Action is eligible for any notification only in a **stable state** (`ready`: post-arbitration, not superseded, prerequisites resolved). A digest never ships an Action that pipeline B might re-rank 30 seconds later — the digest snapshot references the decision_trace it was built from (ADR-044 applied to delivery).
- **Dedupe & cooldown:** intent carries a `dedupe_key` (same discipline as Actions); per-type cooldowns (e.g., a reconnect prompt for the same connection: once, then digest-only mentions until resolved). Repeated identical nags are a budget violation *and* a dedupe violation — two independent guards.
- **Idempotent sends:** ledger-checked before dispatch (queue retries must never double-send; same idempotency law as ingestion).
- **Quiet hours (founder-decided, stricter):** 21:00–08:00 user TZ default. **Only `security_transactional` crosses quiet hours.** A deindexation remains an `urgent_interrupt` but waits for morning — the user can do nothing at 2 AM, hours of delay rarely change the outcome, and the strictness protects a signal: a message that arrives at night *means* security, unambiguously. The crossing list is config with exactly one entry.
- **Preference surface:** every type individually togglable (Section 6 `product_preferences`); digest time picker; one-tap unsubscribe per type from every email (GDPR + deliverability hygiene). **The budget itself is user-visible** (founder reinforcement): Settings → Notifications displays the product's promise in plain words — "Maximum: 1 digest/day · 1 urgent alert/day" — not the technical details, the commitment. The user knows what the product allows itself to do (P5 applied to ourselves). Disabling the digest triggers exactly one honest confirmation ("the digest is how actions reach you — Today in the app remains your feed"), then silence. No winback sequence (Law 12).
- **Deliverability ops (R19 continued):** digest stream on its own sending domain, auth mail separate (already decided); bounce/complaint webhooks feed connection-health-style status — a user whose digests bounce gets an in-app prerequisite Action, not silent disappearance; complaint-rate SLI lives under ADR-047 with `degraded` threshold config'd.
- **Notification ledger:** append-only `(workspace, type, dedupe_key, decision ∈ {sent, batched, suppressed(reason)}, channel, message_ref, template_version, at)` — template_version per founder reinforcement, same philosophy as prompt_template_version in ADR-044: "your digest looked different" must be answerable six months later — powers budget enforcement, the user-visible "recent notifications" in Settings (same transparency pattern as auth events), and ADR-042-style health for the notification system itself (send success, open-signal where available without invasive tracking — **no pixel-level open tracking**; link-click signals only, which we get for free via the app deep links. Spying on email opens would be a strange habit for this particular product).

## 4. Internal Alerts (boundary note, not a system)

ADR-047's `degraded/critical` states alert *operators* through ops channels — entirely separate pipe from user notifications, sharing only the honesty principle. The one designed crossover: a `critical` component whose failure affects a specific workspace's promises (e.g., their GSC ingestion dead >24h) surfaces to that user as a capability-honest in-app notice and, if it blocks their active work, one `urgent_interrupt`. Users hear about *their* consequences, never our infrastructure.

## 5. Phasing & Cost

Launch: email only (decided) — SES/Postmark-class provider, EU processing, on the sub-processor list. Phase 2: PWA push for digest + urgent (opt-in prompt only after the habit exists — first push permission request is config-gated to ≥2 weeks of digest engagement; asking for push on day one is how you get permanently denied). LLM cost: **€0** (deterministic assembly + Evidence Generator templates). Infra cost: email volume ≈ 22 sends/ws/month ≈ negligible.

## 6. Architecture Review Delta (v1.2 → no new entries)

No new ADRs, no new risks, no new principles — the registry table in §1 and the config keys in §3 are the section's entire footprint, filed under ADR-014/046/047. Open question resolved by founder: quiet-hours crossing trimmed to `security_transactional` only — a nighttime message means security, unambiguously. Four founder reinforcements integrated above (digest-wins hierarchy, template_version in ledger, user-visible budget, content-stability rule), all within existing ADRs — zero additions to the referential.
