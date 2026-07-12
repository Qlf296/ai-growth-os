/** @aigos/growth — Growth Intelligence: opportunities, priority, recommendations, lifecycle, feed (Phase 4). */
export { buildOpportunities } from "./opportunity.js";
export type { OpportunityDraft } from "./opportunity.js";
export { registerGrowthWeights, loadWeights, score, rankOpportunities, DEFAULT_WEIGHTS } from "./priority.js";
export type { ScoreInput, ScoreResult, Weights } from "./priority.js";
export { buildRecommendation } from "./recommendation.js";
export type { Recommendation } from "./recommendation.js";
export { transitionOpportunity } from "./lifecycle.js";
export type { OpportunityStatus, Transition } from "./lifecycle.js";
export { buildFeed } from "./feed.js";
export type { Feed, FeedItem } from "./feed.js";
export { getOpportunityDetail } from "./detail.js";
export type { OpportunityDetail, EvidenceRow, TimelineEntry } from "./detail.js";
export { buildGrowth } from "./engine.js";
export type { GrowthBuildParams, GrowthBuildSummary } from "./engine.js";
export * from "./mappings.js";
