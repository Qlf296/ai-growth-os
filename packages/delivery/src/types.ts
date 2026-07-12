/** Delivery shell — I7: the ONLY sender. Pipelines emit intents; Delivery decides (S13 §0). */

export type Channel = "email" | "push";

/** Registry entry — the taxonomy is deliberately short; adding a type is a founder-reviewed change (S13 §1). */
export interface NotificationType {
  readonly type: string;
  readonly channel: Channel;
  /** Sends per workspace per day. Values migrate to the config registry as cadences become tunable (ADR-046). */
  readonly dailyBudget: number;
  readonly cooldownSeconds: number;
  /** security_transactional only (S13 §1) — never marketing. */
  readonly budgetExempt: boolean;
}

/** What pipelines are allowed to emit. Never a message — Delivery renders and sends. */
export interface NotificationIntent {
  readonly workspaceId: string;
  readonly type: string;
  readonly dedupeKey: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/** SDK imports (resend, web-push…) live in driver files inside THIS package only (AT-7). */
export interface ChannelDriver {
  readonly channel: Channel;
  send(message: NotificationIntent): Promise<void>;
}

export type DeliverResult =
  | { delivered: true }
  | { delivered: false; reason: "budget" | "dedupe" | "cooldown" };

/** Suppression is observable, never mysterious (S13 §0; ADR-047). */
export interface SuppressionEntry {
  readonly workspaceId: string;
  readonly type: string;
  readonly dedupeKey: string;
  readonly reason: "budget" | "dedupe" | "cooldown";
  readonly at: string;
}

export type SuppressionLedger = (entry: SuppressionEntry) => Promise<void>;
