/**
 * Recommendation Builder (STEP 4.3). Data only — no generated text. Templates
 * are keyed by the opportunity's dominant detector; the builder fills entities,
 * evidence and impact from the opportunity. No fabricated business value.
 */
import type { OpportunityDraft } from "./opportunity.js";

export interface Recommendation {
  title: string;
  summary: string;
  businessReason: string;
  technicalReason: string;
  expectedImpact: string;
  evidenceIds: string[];
  affectedEntities: string[];
  prerequisites: string[];
  steps: string[];
  rollback: string;
}

interface Template {
  title: string;
  summary: string;
  businessReason: string;
  technicalReason: string;
  steps: string[];
  rollback: string;
}

const TEMPLATES: Record<string, Template> = {
  "seo.striking_distance": {
    title: "Push a striking-distance page into clicks range",
    summary: "This page ranks just outside the top results with real impression volume.",
    businessReason: "Pages ranking 5–20 capture few clicks; small ranking gains convert existing impressions into traffic.",
    technicalReason: "Improve on-page relevance and internal links for the target queries to lift position.",
    steps: ["Review the target queries and current position", "Strengthen the page title and headings for the primary query", "Add internal links from related pages"],
    rollback: "Revert the title/heading and link changes; no data is modified.",
  },
  "seo.ctr_gap": {
    title: "Rewrite title/meta to close the CTR gap",
    summary: "This page's click-through rate is below what its position typically earns.",
    businessReason: "A weak title/description leaves clicks on the table at a ranking you already hold.",
    technicalReason: "The observed CTR is materially below the position-expected CTR for this page.",
    steps: ["Compare the current title/description against the ranking queries", "Rewrite the title to match search intent", "Update the meta description with a clear value proposition"],
    rollback: "Restore the previous title and meta description.",
  },
  "seo.impression_drop": {
    title: "Investigate a sharp impression drop",
    summary: "This page's impressions fell sharply versus the prior window.",
    businessReason: "A sudden visibility loss usually precedes a traffic loss; catching it early limits the damage.",
    technicalReason: "Impressions declined beyond the noise threshold between the prior and recent windows.",
    steps: ["Confirm the page is still indexed", "Check for ranking losses on its top queries", "Review recent content or technical changes to the page"],
    rollback: "No changes are made by this recommendation; it is diagnostic.",
  },
  "seo.click_drop": {
    title: "Investigate a sharp click drop",
    summary: "This page's clicks fell sharply versus the prior window.",
    businessReason: "Lost clicks are lost visits; a fast diagnosis protects acquisition.",
    technicalReason: "Clicks declined beyond the noise threshold between the prior and recent windows.",
    steps: ["Check whether impressions dropped too (visibility) or CTR dropped (SERP presentation)", "Review ranking changes on top queries", "Inspect recent changes to the page or its SERP snippet"],
    rollback: "No changes are made by this recommendation; it is diagnostic.",
  },
};

export function buildRecommendation(opp: OpportunityDraft): Recommendation {
  const t = TEMPLATES[opp.dominantDetector] ?? TEMPLATES["seo.striking_distance"]!;
  return {
    title: t.title,
    summary: t.summary,
    businessReason: t.businessReason,
    technicalReason: t.technicalReason,
    expectedImpact: `Impact ${opp.impact}, effort ${opp.effort}, confidence ${opp.confidence} (measured in clicks; not monetized).`,
    evidenceIds: opp.evidenceIds,
    affectedEntities: [opp.entity],
    prerequisites: ["An active, healthy Google Search Console connection"],
    steps: t.steps,
    rollback: t.rollback,
  };
}
