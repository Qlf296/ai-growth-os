/**
 * Attribution Grader (STEP 8.2; ADR-033). Computes the honesty grade for an
 * outcome from its attribution context and verdict. Grades are labeled evidence
 * (§2); learning weights follow the grade (§3). A requires UTM-keyed
 * attribution (ADR-020, not yet available), so scoped GSC correlation tops out
 * at B; confounders drop it to C; a broad/unmeasurable result is F.
 */
import type { Verdict } from "./outcomes.js";

export type Grade = "A" | "B+" | "B" | "C" | "F";

export interface Attribution {
  /** Result is scoped to the exact edited page/segment (GSC page-scoped). */
  readonly pageScoped: boolean;
  /** UTM-keyed attribution ties result directly to the action (ADR-020). */
  readonly utmKeyed: boolean;
  /** Co-occurring events in the same scope/window (event register, ADR-024). */
  readonly confounders: number;
}

/** Learning weight per grade (§3): A full, B+ just below, B reduced, C minimal, F zero. */
export const LEARNING_WEIGHT: Record<Grade, number> = { A: 1.0, "B+": 0.85, B: 0.6, C: 0.2, F: 0.0 };

export function gradeOutcome(attribution: Attribution, verdict: Verdict): Grade {
  if (verdict === "unmeasurable" || !attribution.pageScoped) return "F";
  if (attribution.utmKeyed) return attribution.confounders > 0 ? "B+" : "A";
  // scoped correlation (GSC page-scoped, no UTM)
  return attribution.confounders > 0 ? "C" : "B";
}
