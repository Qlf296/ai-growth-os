/** @aigos/analytics — outcome measurement, grading, learning (Phase 8). */
export { recordOutcome, verdictFor } from "./outcomes.js";
export { gradeOutcome, LEARNING_WEIGHT } from "./grade.js";
export type { Attribution, Grade } from "./grade.js";
export type { MeasureInput, OutcomeRecord, SubjectType, Verdict } from "./outcomes.js";
export { propagateLearning } from "./propagator.js";
export type { DetectorLearning, PropagateOptions } from "./propagator.js";
export { analyticsSummary } from "./reports.js";
export type { AnalyticsSummary, OutcomeReportRow, TrackRecordRow } from "./reports.js";
