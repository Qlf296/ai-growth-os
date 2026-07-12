/** @aigos/action — AI Action Engine: draft generation, prompt templates, cost, approval, digest (Phase 5). */
export { registerDraftTemplates, templateIdFor, DRAFT_TYPES } from "./templates.js";
export type { DraftType } from "./templates.js";
export { pgCostMeter } from "./cost-meter.js";
export type { CapturedUsage } from "./cost-meter.js";
export { generateDraft } from "./engine.js";
export type { DraftEngineDeps, GeneratedDraft } from "./engine.js";
export { transitionDraft } from "./lifecycle.js";
export type { DraftStatus, DraftTransition } from "./lifecycle.js";
export { usageSummary } from "./usage.js";
export type { UsageSummary } from "./usage.js";
export { listDrafts } from "./list.js";
export type { DraftListItem } from "./list.js";
export { buildDigest } from "./digest.js";
export type { Digest, DigestDraft } from "./digest.js";
