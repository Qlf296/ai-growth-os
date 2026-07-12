/** @aigos/delivery — I7: the ONLY sender (AT-7 enforces). Shell: guards + routing, no workflows. */
export { Delivery } from "./delivery.js";
export type { DeliveryDeps } from "./delivery.js";
export { NotificationTypeRegistry } from "./registry.js";
export type {
  Channel,
  ChannelDriver,
  DeliverResult,
  NotificationIntent,
  NotificationType,
  SuppressionEntry,
  SuppressionLedger,
} from "./types.js";
