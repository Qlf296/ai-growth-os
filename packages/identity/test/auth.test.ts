/**
 * ADR-016 (passwordless magic link) + ADR-017 (server-side rotating sessions).
 * Real Postgres; the link goes out through Delivery (I7) — never directly.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Delivery, NotificationTypeRegistry, type NotificationIntent } from "@aigos/delivery";

import { MagicLinkService, SessionService } from "../src/index.js";
import { startHarness, type Harness } from "../../database/test/harness.js";

let h: Harness;
let magic: MagicLinkService;
let sessions: SessionService;
const outbox: NotificationIntent[] = [];
let now = new Date("2026-07-12T10:00:00Z");
const clock = () => now;

const UA = "Safari-macOS";
const EMAIL = "halim@test.dev";

beforeAll(async () => {
  h = await startHarness();
  const registry = new NotificationTypeRegistry();
  registry.register({
    type: "security_transactional",
    channel: "email",
    dailyBudget: 0,
    cooldownSeconds: 0,
    budgetExempt: true, // S13 §1
  });
  const delivery = new Delivery({
    registry,
    channels: [{ channel: "email", send: async (m) => void outbox.push(m) }],
    ledger: async () => {},
    clock,
  });
  magic = new MagicLinkService(h.app, delivery, clock, { baseUrl: "https://app.test" });
  sessions = new SessionService(h.app, clock);
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe("magic link (ADR-016)", () => {
  it("request stores only a hash and sends the link through Delivery (I7)", async () => {
    await magic.request(EMAIL, UA, "203.0.113.7");
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.type).toBe("security_transactional");
    expect(outbox[0]?.body).toMatch(/https:\/\/app\.test\/auth\/confirm\?token=[a-f0-9]{64}/);
    const rows = await h.admin.query("SELECT token_hash, expires_at FROM magic_link_tokens");
    expect(rows.rowCount).toBe(1);
    const token = /token=([a-f0-9]{64})/.exec(outbox[0]!.body)![1]!;
    expect(rows.rows[0].token_hash.toString("hex")).not.toContain(token); // hashed at rest
  });

  it("consume returns the email once, then never again (single-use)", async () => {
    const token = /token=([a-f0-9]{64})/.exec(outbox[0]!.body)![1]!;
    expect(await magic.consume(token, UA)).toBe(EMAIL);
    expect(await magic.consume(token, UA)).toBeNull();
  });

  it("a token bound to another user-agent family is refused (generic null, no oracle)", async () => {
    await magic.request(EMAIL, UA, "203.0.113.7");
    const token = /token=([a-f0-9]{64})/.exec(outbox.at(-1)!.body)![1]!;
    expect(await magic.consume(token, "Chrome-Windows")).toBeNull();
  });

  it("expires after 10 minutes", async () => {
    await magic.request(EMAIL, UA, "203.0.113.7");
    const token = /token=([a-f0-9]{64})/.exec(outbox.at(-1)!.body)![1]!;
    now = new Date(now.getTime() + 11 * 60_000);
    expect(await magic.consume(token, UA)).toBeNull();
  });

  it("rate limit: >3 requests per email per hour are refused silently (no oracle)", async () => {
    const before = outbox.length;
    await magic.request(EMAIL, UA, "203.0.113.7"); // 4th within the hour
    expect(outbox.length).toBe(before); // nothing sent
    const audit = await h.admin.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE event = 'magic_link.rate_limited'",
    );
    expect(audit.rows[0].n).toBe(1); // refusal is observable in audit, invisible to the caller
  });
});

describe("sessions (ADR-017 — server-side, rotating refresh)", () => {
  let userId: string;
  let issued: { sessionId: string; refreshToken: string };

  beforeAll(async () => {
    userId = randomUUID();
    await h.admin.query(
      "INSERT INTO users (id, email, auth_provider) VALUES ($1, $2, 'magic_link')",
      [userId, EMAIL],
    );
    issued = await sessions.issue(userId, UA, "203.0.113.7");
  });

  it("an issued session validates and carries the user", async () => {
    const current = await sessions.validate(issued.sessionId);
    expect(current?.userId).toBe(userId);
  });

  it("access expires after 15 minutes; refresh rotates into a fresh session", async () => {
    now = new Date(now.getTime() + 16 * 60_000);
    expect(await sessions.validate(issued.sessionId)).toBeNull();
    const rotated = await sessions.refresh(issued.refreshToken, UA);
    expect(rotated).not.toBeNull();
    expect(rotated!.refreshToken).not.toBe(issued.refreshToken);
    expect((await sessions.validate(rotated!.sessionId))?.userId).toBe(userId);
    issued = rotated!;
  });

  it("refresh reuse (stolen token) revokes the whole family", async () => {
    const rotated = await sessions.refresh(issued.refreshToken, UA);
    expect(rotated).not.toBeNull();
    // replay the OLD refresh token — reuse detection must kill the family
    expect(await sessions.refresh(issued.refreshToken, UA)).toBeNull();
    expect(await sessions.validate(rotated!.sessionId)).toBeNull();
    const audit = await h.admin.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE event = 'session.family_revoked'",
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it("revocation is instant (a query, not a cryptographic apology)", async () => {
    const s = await sessions.issue(userId, UA, "203.0.113.7");
    await sessions.revoke(s.sessionId);
    expect(await sessions.validate(s.sessionId)).toBeNull();
  });
});
