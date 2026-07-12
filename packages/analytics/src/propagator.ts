/**
 * Learning Propagator (STEP 8.3; S11 §3). The single writer of learned
 * detector track records (I5 — one auditable pen). Recomputes each detector's
 * grade-weighted success from graded outcomes over its contributing
 * opportunities, bounded to [0,1], abstaining below a min-samples floor
 * (ADR-013 "slowly and boundedly"; ADR-042 detector health). No fabrication:
 * unmeasurable outcomes are excluded.
 */
import { withWorkspace } from "@aigos/database";
import type pg from "pg";

import { LEARNING_WEIGHT, type Grade } from "./grade.js";

const VERDICT_SUCCESS: Record<string, number> = { met: 1, partial: 0.5, not_met: 0 };

export interface DetectorLearning {
  detector: string;
  score: number | null;
  samples: number;
  health: "healthy" | "degraded" | "retire_candidate" | "insufficient_data";
}

export interface PropagateOptions {
  minSamples?: number; // abstention floor (default 5)
}

export async function propagateLearning(pool: pg.Pool, workspaceId: string, options: PropagateOptions = {}): Promise<DetectorLearning[]> {
  const minSamples = options.minSamples ?? 5;
  return withWorkspace(pool, workspaceId, async (tx) => {
    // Join measured outcomes (opportunity subjects) with their contributing detectors.
    const rows = await tx.query(
      `SELECT d.detector AS detector, oe.verdict, oe.grade
       FROM outcome_evaluations oe
       JOIN opportunities o ON o.id = oe.subject_id AND oe.subject_type = 'opportunity'
       CROSS JOIN LATERAL jsonb_array_elements_text(o.detectors) AS d(detector)
       WHERE oe.verdict <> 'unmeasurable'`,
    );

    const acc = new Map<string, { weighted: number; weight: number; samples: number }>();
    for (const r of rows.rows as Array<{ detector: string; verdict: string; grade: Grade | null }>) {
      const w = LEARNING_WEIGHT[(r.grade ?? "F")];
      const success = VERDICT_SUCCESS[r.verdict] ?? 0;
      const cur = acc.get(r.detector) ?? { weighted: 0, weight: 0, samples: 0 };
      cur.weighted += success * w;
      cur.weight += w;
      cur.samples += 1;
      acc.set(r.detector, cur);
    }

    const out: DetectorLearning[] = [];
    for (const [detector, a] of acc) {
      const score = a.samples >= minSamples && a.weight > 0 ? Math.max(0, Math.min(1, a.weighted / a.weight)) : null;
      const health: DetectorLearning["health"] =
        score === null ? "insufficient_data" : score === 0 ? "retire_candidate" : score < 0.3 ? "degraded" : "healthy";
      out.push({ detector, score, samples: a.samples, health });
      await tx.query(
        `INSERT INTO detector_track_record (workspace_id, detector, score, samples, health, updated_at)
         VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, $2, $3, $4, now())
         ON CONFLICT (workspace_id, detector) DO UPDATE SET score = EXCLUDED.score, samples = EXCLUDED.samples, health = EXCLUDED.health, updated_at = now()`,
        [detector, score, a.samples, health],
      );
    }
    await tx.query(
      `INSERT INTO audit_log (workspace_id, actor, event, details) VALUES ($1, 'learning-propagator', 'learning.propagated', $2::jsonb)`,
      [workspaceId, JSON.stringify({ detectors: out.map((o) => ({ detector: o.detector, score: o.score, health: o.health, samples: o.samples })) })],
    );
    return out.sort((x, y) => (x.detector < y.detector ? -1 : 1));
  });
}
