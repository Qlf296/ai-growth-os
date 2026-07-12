/**
 * Delivery shell (I7/AT-7 — the ONLY sender; S13 §0-§3; ADR-014).
 * Pipeline under test: intent → type registry → budget → dedupe/cooldown → send.
 * Suppression is observable, never mysterious (ledgered with reason).
 * No business workflows here — a fake channel driver exercises the shell.
 */
import { describe, expect, it } from "vitest";

import {
  Delivery,
  NotificationTypeRegistry,
  type ChannelDriver,
  type SuppressionEntry,
} from "../src/index.js";

function registry() {
  const r = new NotificationTypeRegistry();
  r.register({ type: "daily_digest", channel: "email", dailyBudget: 1, cooldownSeconds: 0, budgetExempt: false });
  r.register({ type: "security_transactional", channel: "email", dailyBudget: 0, cooldownSeconds: 0, budgetExempt: true });
  r.register({ type: "reconnect_prompt", channel: "email", dailyBudget: 2, cooldownSeconds: 3600, budgetExempt: false });
  return r;
}

function fakeChannel(): ChannelDriver & { sent: { to: string; subject: string }[] } {
  const sent: { to: string; subject: string }[] = [];
  return {
    channel: "email",
    sent,
    async send(message) {
      sent.push({ to: message.to, subject: message.subject });
    },
  };
}

function makeDelivery(now = () => new Date("2026-07-12T08:00:00Z")) {
  const channel = fakeChannel();
  const suppressed: SuppressionEntry[] = [];
  const delivery = new Delivery({
    registry: registry(),
    channels: [channel],
    ledger: async (entry) => {
      suppressed.push(entry);
    },
    clock: now,
  });
  return { delivery, channel, suppressed };
}

const INTENT = {
  workspaceId: "ws1",
  type: "daily_digest",
  dedupeKey: "digest:2026-07-12",
  to: "halim@test.dev",
  subject: "Your day",
  body: "2 actions today — a light day",
};

describe("intent → send", () => {
  it("a registered intent within budget sends through the channel driver", async () => {
    const { delivery, channel } = makeDelivery();
    const result = await delivery.deliver(INTENT);
    expect(result).toEqual({ delivered: true });
    expect(channel.sent).toEqual([{ to: "halim@test.dev", subject: "Your day" }]);
  });

  it("an unregistered type is structurally impossible to send (S13 §1)", async () => {
    const { delivery, channel } = makeDelivery();
    await expect(delivery.deliver({ ...INTENT, type: "streak_reminder" })).rejects.toThrow(
      /not in the registry/i,
    );
    expect(channel.sent).toHaveLength(0);
  });
});

describe("budget (ADR-014) — suppression is observable, never mysterious", () => {
  it("over-budget intents die silently but are ledgered as suppressed(budget)", async () => {
    const { delivery, channel, suppressed } = makeDelivery();
    await delivery.deliver(INTENT);
    const second = await delivery.deliver({ ...INTENT, dedupeKey: "digest:extra" });
    expect(second).toEqual({ delivered: false, reason: "budget" });
    expect(channel.sent).toHaveLength(1);
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]).toMatchObject({ type: "daily_digest", workspaceId: "ws1", reason: "budget" });
  });

  it("budgets are per-workspace: ws2 is unaffected by ws1's spend", async () => {
    const { delivery, channel } = makeDelivery();
    await delivery.deliver(INTENT);
    const other = await delivery.deliver({ ...INTENT, workspaceId: "ws2", dedupeKey: "d2" });
    expect(other).toEqual({ delivered: true });
    expect(channel.sent).toHaveLength(2);
  });

  it("security_transactional is exempt from budget (S13 §1), never suppressed by it", async () => {
    const { delivery, channel } = makeDelivery();
    for (let i = 0; i < 3; i++) {
      const r = await delivery.deliver({
        ...INTENT,
        type: "security_transactional",
        dedupeKey: `sec-${i}`,
        subject: "New device",
      });
      expect(r).toEqual({ delivered: true });
    }
    expect(channel.sent).toHaveLength(3);
  });
});

describe("dedupe + cooldown (S13 §3 — two independent guards)", () => {
  it("an identical dedupe_key never sends twice", async () => {
    const { delivery, channel, suppressed } = makeDelivery();
    await delivery.deliver(INTENT);
    // budget would also block; use the exempt type to isolate the dedupe guard
    await delivery.deliver({ ...INTENT, type: "security_transactional", dedupeKey: "same" });
    const dup = await delivery.deliver({ ...INTENT, type: "security_transactional", dedupeKey: "same" });
    expect(dup).toEqual({ delivered: false, reason: "dedupe" });
    expect(channel.sent).toHaveLength(2);
    expect(suppressed.at(-1)?.reason).toBe("dedupe");
  });

  it("per-type cooldown suppresses a repeat within the window", async () => {
    let t = new Date("2026-07-12T08:00:00Z");
    const { delivery, channel } = makeDelivery(() => t);
    await delivery.deliver({ ...INTENT, type: "reconnect_prompt", dedupeKey: "r1" });
    t = new Date("2026-07-12T08:30:00Z"); // 30 min < 1 h cooldown
    const tooSoon = await delivery.deliver({ ...INTENT, type: "reconnect_prompt", dedupeKey: "r2" });
    expect(tooSoon).toEqual({ delivered: false, reason: "cooldown" });
    t = new Date("2026-07-12T09:30:00Z"); // past cooldown
    const later = await delivery.deliver({ ...INTENT, type: "reconnect_prompt", dedupeKey: "r3" });
    expect(later).toEqual({ delivered: true });
    expect(channel.sent).toHaveLength(2);
  });
});

describe("channel routing", () => {
  it("an intent whose channel has no driver fails loudly (no silent drop of a wanted send)", async () => {
    const r = new NotificationTypeRegistry();
    r.register({ type: "daily_digest", channel: "push", dailyBudget: 1, cooldownSeconds: 0, budgetExempt: false });
    const delivery = new Delivery({ registry: r, channels: [fakeChannel()], ledger: async () => {}, clock: () => new Date() });
    await expect(delivery.deliver(INTENT)).rejects.toThrow(/no driver/i);
  });
});
