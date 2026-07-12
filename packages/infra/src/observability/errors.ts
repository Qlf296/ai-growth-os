/** Error tracking hook: process-level capture → structured log. External platform plugs into the sink later. */
import type { Logger } from "./logger.js";

export function installErrorTracking(logger: Logger): void {
  process.on("uncaughtException", (error) => {
    logger.error("uncaughtException", { error: error.message, stack: error.stack });
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("unhandledRejection", { reason: String(reason) });
  });
}
