# AI Growth OS — Section 6: Authentication & User Management

**Status:** Proposed v1 — pending founder review
**Depends on:** Section 2 §11 (security boundaries, token vault), Section 3 §2 (tenancy schema), Founder decisions (Model A launch / Model B-ready schema)
**Posture:** this is deliberately the most boring section of the spec. Authentication is a domain where creativity is a liability; we buy proven mechanisms, minimize what we store, and keep every custom decision auditable. Security is priority #2, and the cheapest security win available is *not possessing secrets we don't need*.

---

## 1. Authentication Methods

**ADR-016 — Passwordless at launch: Google OAuth + email magic link. No password storage, ever, in v1.**

- **Context:** the audience is founders/professionals (Google-account penetration ≈ total); we already custody OAuth tokens for their marketing stack, so *our* auth layer must not become the weak door.
- **Why passwordless:** eliminating the password table eliminates credential-stuffing, password-reuse breaches, reset-flow phishing, and bcrypt-parameter bikeshedding in one decision. Magic link covers the non-Google minority.
- **Alternatives considered:** (a) passwords + all of the above risk surface — rejected; (b) GitHub OAuth — rejected for launch: our audience is marketing/career-side, not developer-identity-first; it's a config-level addition later if data says otherwise; (c) Apple Sign-In — added only when/if a native app store presence demands it.
- **Magic link mechanics:** single-use token, 10-minute expiry, bound to requesting user-agent family, rate-limited per email (3/hour) and per IP; the email states device/location of the request. Link opens a confirmation tap (prevents link-scanner consumption by corporate mail filters — a classic magic-link failure mode).
- **MFA:** Google users inherit Google's 2FA. TOTP for magic-link users is Phase 2, prioritized before Agency tier ships (higher-value accounts). Not launch-blocking: the account's blast radius is bounded by §5's session controls and the token vault's separate protection.

## 2. Session & Security Model

**ADR-017 — Cookie sessions with rotating refresh; no JWTs-as-session.**

- httpOnly, Secure, SameSite=Lax cookies; short-lived access session (15 min) + refresh token rotated on every use, family-invalidated on reuse detection (stolen-refresh defense).
- Server-side session store (Postgres `sessions` table) → **instant revocation is a query**, not a cryptographic apology. JWT session statelessness was considered and rejected: revocation latency is unacceptable for an app holding third-party tokens, and our scale doesn't need stateless verification.
- Sessions carry `workspace_id` context per request (feeds RLS, Section 3 §11); device list visible to the user in Settings with per-device sign-out; global sign-out on email change.
- Standard hygiene, stated once: CSRF tokens on state-changing routes (SameSite is belt, this is suspenders), strict rate limits on auth endpoints, generic auth error messages (no account-existence oracle), new-device sign-in notification email, session events → `audit_log`.

```sql
sessions (
  id uuid PK, user_id, workspace_id_context uuid,
  refresh_family uuid, refresh_hash bytea, rotated_at,
  ua_family text, ip_created inet, created_at, expires_at, revoked_at
)
```

## 3. Signup & Workspace Creation Logic

```
Signup (Google | magic link)
  → users row
  → consent capture (§4) — blocking, minimal, honest
  → workspaces row auto-created ("Halim's workspace", region 'eu', plan 'free')
  → memberships (user, workspace, role='owner')
  → Strategy interview → onboarding (Section 5 §2)
```

- One personal workspace auto-created; **users may own multiple workspaces from day one** (schema already supports it; the UI exposes a simple switcher). This is deliberate: it's near-free now, and it's the natural seam where the Agency tier later attaches — an agency is "one user, many workspaces" before it's "many users, one workspace."
- Workspace deletion: owner-only, typed-confirmation, 14-day soft-delete grace (undo window), then the GDPR purge pipeline from Section 3 §2. Deletion of the *user account* requires first deleting/transferring owned workspaces — no orphaned tenants.

## 4. GDPR & Consent Flows

Principle: **consent asked when meaningful, never bundled, always revocable in one place.**

- **At signup (blocking):** ToS + Privacy Policy acceptance — one checkbox, versioned (`consents` table records doc version + timestamp + IP → audit-grade).
- **Separately, never pre-checked:** product-update emails (marketing). The **morning digest is not marketing** — it's the product's core function, enabled by an explicit onboarding step ("When should your daily briefing arrive?") and disable-able in one tap from every email footer. Transactional (security, billing) has no opt-out, per standard practice.
- **At each provider connection (contextual consent):** a plain-language screen before OAuth: *what we read, what we never do* ("We read your Search Console performance data. We never modify your site, never post without your action."). Stored as a consent record per connection. This doubles as the honest-capability messaging from R12.
- **Rights implementation** (already structural from Section 3): export = per-workspace dump job (JSON + CSVs, delivered via time-limited link); deletion = purge pipeline incl. S3 payloads, embeddings, ledger anonymization; rectification = Settings covers profile + Strategy Profile edits.
- `consents (user_id, kind, doc_version, granted, at, ip)` — append-only, revocation is a new row.
- Sub-processor list (hosting, email, LLM providers, SERP API) published in the privacy policy from day one; LLM providers configured with no-training/retention-off flags — worth stating in the DPA because users' ingested content transits the Gateway.

## 5. Roles & Model-B Future-Proofing (without building Model B)

**ADR-018 — Launch is single-user-per-workspace in UI; schema is already multi-user; no RBAC engine.**

- `memberships.role ∈ {owner, admin, member}` exists (Section 3). Launch UI creates only `owner`. Authorization at launch is exactly two checks: *is a member* (data access, via RLS) and *is owner* (destructive/billing operations). That's an `if`, not a policy engine — a real RBAC engine is the scaling trigger's job, not today's.
- Per founder decision, `actions.assigned_to` and `actions.completed_by` (nullable FKs) ship now, defaulting to the sole member — zero UI, zero behavior change, and Model B's core migration is already done.
- **Invitations: documented, not built.** No dormant `invitations` table (evolution principle: unused schema is untested schema). The migration is written down in the ADR: `invitations(email, workspace_id, role, token_hash, expires_at)` + accept-flow reusing the magic-link mechanics — an estimated 2–3 day feature when Model B's trigger fires (first genuine team-plan demand, likely Agency tier).
- What we consciously do **not** build now: comments, mentions, per-action permissions, approval workflows, teams. Each is listed in the ADR with its trigger so "not now" never silently becomes "forgot."

## 6. Anti-Abuse (free tier protection)

Light but present, because free tier + background compute invites abuse: signup rate-limiting per IP/fingerprint; disposable-email domain blocklist (data file, maintainable); free-tier job scheduling in a lower-priority queue lane (paid workspaces never wait behind free backfills — also a nice upgrade incentive); anomaly alert on workspace-creation bursts. Nothing heavier until abuse data justifies it.

## 7. Audit Events (auth domain, canonical list)

`signin.success/failed`, `magic_link.requested/consumed`, `session.revoked` (+which device), `email.change_requested/confirmed`, `consent.granted/revoked`, `workspace.created/deleted/restored`, `membership.role_changed` (future), `export.requested/delivered`, `deletion.requested/purged`, `provider.connected/disconnected`. All → append-only `audit_log`, user-visible subset rendered in Settings → Security ("recent activity") — transparency as a trust feature, consistent with the Learnings philosophy.

---

## 8. Architecture Review Delta (v0.6)

**New ADRs:** ADR-016 (passwordless launch) · ADR-017 (server-side rotating sessions, JWT-as-session rejected) · ADR-018 (Model A UI on Model B schema; invitations documented-not-built; ownership fields shipped dormant).
**Ratified this round (from founder review):** reason-weighted category affinity (exact mapping adopted) · track record multiplicative in ranking but **never mutating the displayed confidence label** (label stays evidence-only — logged as a clarification under D2/ADR-013) · analyst-voice email digest, no guilt copy, momentum wording "actions completed / learning unlocked" · no Analytics tab and no streaks now founder-ratified (R-log: closed as decisions, not defaults).
**New risks:** R19 — magic-link deliverability (corporate filters, link scanners) → confirmation-tap pattern + Google OAuth as primary path + deliverability monitoring on the auth mail stream, separate sending domain from digests so reputation issues never lock users out.
**Open questions for founder:**
1. Digest sending identity: from "AI Growth OS" or a persona name? The analyst-voice email you sketched reads naturally from a named sender (subject + first line in the analyst's voice). My recommendation: product name + consistent voice, no fake human name — the honesty posture extends to not pretending the analyst is a person.
2. Free-tier workspace limit per user (anti-abuse lever): proposal 2.
3. Session length for "remember me": proposal 30-day refresh horizon, 90 days feels long for an app holding marketing-stack tokens.
