/**
 * Opportunity Engine (STEP 4.1). Groups a day's detector findings by page
 * (one page = one opportunity, ADR-031), deriving impact/difficulty/effort/ROI
 * deterministically. Priority is computed by the Priority Engine.
 */
import { createHash } from "node:crypto";

import type { StoredFinding } from "@aigos/intelligence";

import {
  DETECTOR_PROFILE, EFFORT_LABEL, SEVERITY_RANK, makeRoi,
  type Confidence, type Severity, type Tier,
} from "./mappings.js";

export interface OpportunityDraft {
  entity: string;
  category: string;
  detectors: string[];
  dominantDetector: string;
  severity: Severity;
  confidence: Confidence;
  impact: Tier;
  difficulty: Tier;
  effort: Tier;
  effortLabel: string;
  roi: ReturnType<typeof makeRoi>;
  evidenceIds: string[];
  occurredOn: string;
  dedupeHash: string;
}

/** Group findings by entity → one deterministic opportunity draft per page. */
export function buildOpportunities(findings: readonly StoredFinding[], occurredOn: string): OpportunityDraft[] {
  const byEntity = new Map<string, StoredFinding[]>();
  for (const f of findings) {
    const list = byEntity.get(f.entity) ?? [];
    list.push(f);
    byEntity.set(f.entity, list);
  }
  const drafts: OpportunityDraft[] = [];
  for (const [entity, group] of byEntity) {
    // Dominant finding = highest severity, then detector name for stability.
    const dominant = [...group].sort(
      (a, b) => SEVERITY_RANK[b.severity as Severity] - SEVERITY_RANK[a.severity as Severity] || (a.detector < b.detector ? -1 : 1),
    )[0]!;
    const profile = DETECTOR_PROFILE[dominant.detector] ?? { impact: "medium", difficulty: "medium", effort: "medium" };
    const detectors = [...new Set(group.map((f) => f.detector))].sort();
    const evidenceIds = [...new Set(group.map((f) => f.evidenceId))].sort();
    drafts.push({
      entity,
      category: dominant.category,
      detectors,
      dominantDetector: dominant.detector,
      severity: dominant.severity as Severity,
      confidence: dominant.confidence as Confidence,
      impact: profile.impact,
      difficulty: profile.difficulty,
      effort: profile.effort,
      effortLabel: EFFORT_LABEL[profile.effort],
      roi: makeRoi(profile.impact),
      evidenceIds,
      occurredOn,
      dedupeHash: createHash("sha256").update(`${entity}|${occurredOn}`).digest("hex"),
    });
  }
  // Deterministic order by entity (priority applied later).
  return drafts.sort((a, b) => (a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : 0));
}
