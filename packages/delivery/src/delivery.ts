/**
 * The single send path (I7/AT-7). Pipeline per intent (S13 §0):
 * classify (registry) → budget (ADR-014) → dedupe + cooldown → send.
 * State is in-memory in the shell; it moves behind the Cache/DB ports when
 * the digest workflow lands (Phase 1) — the guards' semantics are fixed here.
 */
import type { NotificationTypeRegistry } from "./registry.js";
import type {
  ChannelDriver,
  DeliverResult,
  NotificationIntent,
  SuppressionLedger,
} from "./types.js";

export interface DeliveryDeps {
  readonly registry: NotificationTypeRegistry;
  readonly channels: readonly ChannelDriver[];
  readonly ledger: SuppressionLedger;
  readonly clock: () => Date;
}

export class Delivery {
  private readonly sentDedupeKeys = new Set<string>();
  private readonly dailyCounts = new Map<string, number>(); // ws/type/day → count
  private readonly lastSentAt = new Map<string, number>();  // ws/type → epoch ms

  constructor(private readonly deps: DeliveryDeps) {}

  async deliver(intent: NotificationIntent): Promise<DeliverResult> {
    const type = this.deps.registry.resolve(intent.type);
    const now = this.deps.clock();

    const suppress = async (reason: "budget" | "dedupe" | "cooldown"): Promise<DeliverResult> => {
      await this.deps.ledger({
        workspaceId: intent.workspaceId,
        type: intent.type,
        dedupeKey: intent.dedupeKey,
        reason,
        at: now.toISOString(),
      });
      return { delivered: false, reason };
    };

    if (!type.budgetExempt) {
      const day = now.toISOString().slice(0, 10);
      const budgetKey = `${intent.workspaceId}/${intent.type}/${day}`;
      if ((this.dailyCounts.get(budgetKey) ?? 0) >= type.dailyBudget) return suppress("budget");
    }

    const dedupeKey = `${intent.workspaceId}/${intent.dedupeKey}`;
    if (this.sentDedupeKeys.has(dedupeKey)) return suppress("dedupe");

    const cooldownKey = `${intent.workspaceId}/${intent.type}`;
    const last = this.lastSentAt.get(cooldownKey);
    if (last !== undefined && now.getTime() - last < type.cooldownSeconds * 1000) {
      return suppress("cooldown");
    }

    const driver = this.deps.channels.find((c) => c.channel === type.channel);
    if (!driver) {
      throw new Error(`No driver for channel "${type.channel}" — a wanted send must never drop silently`);
    }
    await driver.send(intent);

    this.sentDedupeKeys.add(dedupeKey);
    const day = now.toISOString().slice(0, 10);
    const budgetKey = `${intent.workspaceId}/${intent.type}/${day}`;
    this.dailyCounts.set(budgetKey, (this.dailyCounts.get(budgetKey) ?? 0) + 1);
    this.lastSentAt.set(cooldownKey, now.getTime());
    return { delivered: true };
  }
}
