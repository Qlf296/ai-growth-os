/**
 * Knowledge promotion (STEP 9.4; ADR-012). The Learning Propagator is the only
 * writer (I5). Promotion to 'validated' requires hard criteria: enough samples,
 * enough Grade-A outcomes, stable results, and shadow-eval approval — never
 * otherwise (ADR-013 bounded evolution; ADR-045 gate). Levels can demote if
 * criteria are lost (rollback); nothing is fabricated.
 */
import { withWorkspace } from "@aigos/database";
import type pg from "pg";

export type EpistemicLevel = "hypothesis" | "observation" | "validated";

export interface PromotionCriteria {
  minSamplesObservation?: number; // default 5
  minSamplesValidated?: number;   // default 10
  minGradeAValidated?: number;    // default 3
}

export interface PromotionInput {
  samples: number;
  gradeACount: number;
  stable: boolean;
  shadowApproved: boolean;
}

/** Pure rule: the highest level the evidence honestly supports. */
export function evaluatePromotion(input: PromotionInput, criteria: PromotionCriteria = {}): EpistemicLevel {
  const minObs = criteria.minSamplesObservation ?? 5;
  const minVal = criteria.minSamplesValidated ?? 10;
  const minA = criteria.minGradeAValidated ?? 3;
  if (input.samples >= minVal && input.gradeACount >= minA && input.stable && input.shadowApproved) return "validated";
  if (input.samples >= minObs) return "observation";
  return "hypothesis";
}

export async function promoteKnowledge(
  pool: pg.Pool,
  workspaceId: string,
  key: string,
  input: PromotionInput,
  evidenceIds: string[],
  criteria: PromotionCriteria = {},
): Promise<{ level: EpistemicLevel }> {
  const level = evaluatePromotion(input, criteria);
  return withWorkspace(pool, workspaceId, async (tx) => {
    await tx.query(
      `INSERT INTO kb_entries (workspace_id, key, epistemic_level, samples, grade_a_count, evidence_ids, updated_at)
       VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, $2, $3, $4, $5::jsonb, now())
       ON CONFLICT (workspace_id, key) DO UPDATE SET
         epistemic_level = EXCLUDED.epistemic_level, samples = EXCLUDED.samples,
         grade_a_count = EXCLUDED.grade_a_count, evidence_ids = EXCLUDED.evidence_ids, updated_at = now()`,
      [key, level, input.samples, input.gradeACount, JSON.stringify(evidenceIds)],
    );
    await tx.query(
      `INSERT INTO audit_log (workspace_id, actor, event, details) VALUES ($1, 'learning-propagator', 'kb.promotion', $2::jsonb)`,
      [workspaceId, JSON.stringify({ key, level, samples: input.samples, gradeACount: input.gradeACount, stable: input.stable, shadowApproved: input.shadowApproved })],
    );
    return { level };
  });
}
