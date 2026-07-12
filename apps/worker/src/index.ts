/**
 * Worker process skeleton (S2 §1: web + worker from one codebase).
 * Boot wiring only — job families register with the dispatcher as their
 * modules land (ingestion, pipelines… Phase 1). No speculative handlers.
 */
export { tick } from "./scheduler.js";
export type { JobDefinition, SchedulerPayload, TickWindow } from "./scheduler.js";
export { canaryHandler } from "./canary.js";
export { createGscIngestionHandler, registerGscQuotaKeys } from "./ingestion.js";
export type { IngestionDeps, IngestionJobPayload } from "./ingestion.js";
export { createDetectionHandler } from "./detection.js";
export type { DetectionDeps, DetectionJobPayload } from "./detection.js";
export { createGrowthHandler } from "./growth.js";
export type { GrowthDeps, GrowthJobPayload } from "./growth.js";
export { createAutomationHandler } from "./automation.js";
export type { AutomationDeps, AutomationJobPayload } from "./automation.js";
