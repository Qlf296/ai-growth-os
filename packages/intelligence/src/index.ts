/** @aigos/intelligence — signal registry, rule engine, SEO detectors, evidence (Phase 3). */
export { SIGNAL_TYPES, DETECTOR_CATALOG } from "./registry.js";
export type { Category, Confidence, DetectorMeta, Severity, SignalTypeMeta } from "./registry.js";
export { makeEvidence } from "./evidence.js";
export type { Evidence, EvidenceInput } from "./evidence.js";
export { loadRules, setWorkspaceRule } from "./rules.js";
export type { DetectorRule } from "./rules.js";
export { ALL_DETECTORS, aggregatePages, strikingDistance, ctrGap, impressionDrop, clickDrop } from "./detectors/index.js";
export type { Detector, DetectorInput, Finding, PageAggregate } from "./detectors/types.js";
export { runDetection } from "./engine.js";
export type { DetectionParams, DetectionSummary } from "./engine.js";
