/** Notification type registry — no type, no send path (S13 §1). */
import type { NotificationType } from "./types.js";

export class NotificationTypeRegistry {
  private readonly types = new Map<string, NotificationType>();

  register(type: NotificationType): void {
    if (this.types.has(type.type)) {
      throw new Error(`Notification type "${type.type}" already registered`);
    }
    this.types.set(type.type, type);
  }

  resolve(type: string): NotificationType {
    const entry = this.types.get(type);
    if (!entry) {
      throw new Error(
        `Notification type "${type}" is not in the registry — no type, no send path (S13 §1)`,
      );
    }
    return entry;
  }
}
