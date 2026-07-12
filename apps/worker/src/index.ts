/**
 * Worker process skeleton (S2 §1: web + worker from one codebase).
 * Boot wiring only — job families register with the dispatcher as their
 * modules land (ingestion, pipelines… Phase 1). No speculative handlers.
 */
export { tick } from "./scheduler.js";
export type { JobDefinition, SchedulerPayload, TickWindow } from "./scheduler.js";
export { canaryHandler } from "./canary.js";
