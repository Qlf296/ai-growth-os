/**
 * Detection engine (STEP 3.2/3.5). Deterministic, evidence-bearing, idempotent.
 * Reads normalized signals, runs enabled detectors in priority order, and
 * persists evidence (I4) + findings + a per-detector run trace. Re-running the
 * same window is a no-op (content-addressed evidence + dedupe_hash) → replay
 * determinism.
 */
import { createHash, randomUUID } from "node:crypto";

import type pg from "pg";

import { readSignalsByType, withWorkspace } from "@aigos/database";
import type { MetricsRegistry } from "@aigos/infra";

import { ALL_DETECTORS, aggregatePages } from "./detectors/index.js";
import type { Detector } from "./detectors/types.js";
import { makeEvidence } from "./evidence.js";
import { loadRules, type DetectorRule } from "./rules.js";

const SIGNAL_TYPE = "gsc.search_analytics.daily";
const DAY = 86_400_000;
const dayString = (d: Date): string => d.toISOString().slice(0, 10);

export interface DetectionParams {
  readonly pool: pg.Pool;
  readonly workspaceId: string;
  readonly now: Date;
  readonly windowDays?: number; // recent window length; prior is the preceding equal window
  readonly metrics?: MetricsRegistry;
  readonly detectors?: readonly Detector[];
}

export interface DetectionSummary {
  readonly findings: number;
  readonly perDetector: Record<string, number>;
  readonly windowFrom: string;
  readonly windowTo: string;
}

export async function runDetection(params: DetectionParams): Promise<DetectionSummary> {
  const windowDays = params.windowDays ?? 7;
  const to = new Date(dayString(params.now)); // day-aligned
  const splitAt = new Date(to.getTime() - windowDays * DAY);
  const from = new Date(to.getTime() - 2 * windowDays * DAY);

  const rows = await withWorkspace(params.pool, params.workspaceId, (tx) =>
    readSignalsByType(tx, SIGNAL_TYPE, from, to),
  );
  const recent = aggregatePages(rows.filter((r) => r.occurredAt >= splitAt));
  const prior = aggregatePages(rows.filter((r) => r.occurredAt < splitAt));

  const rules = await loadRules(params.pool, params.workspaceId);
  const detectors = [...(params.detectors ?? ALL_DETECTORS)].sort(
    (a, b) => (rules.get(a.name)?.priority ?? 1e9) - (rules.get(b.name)?.priority ?? 1e9),
  );

  const perDetector: Record<string, number> = {};
  let total = 0;

  for (const detector of detectors) {
    const rule: DetectorRule = rules.get(detector.name) ?? { detector: detector.name, enabled: true, priority: 100, version: 1, thresholds: {} };
    if (!rule.enabled) continue;

    const runId = randomUUID();
    const startedAt = new Date();
    let findingsCount = 0;
    try {
      const findings = detector.detect({ recent, prior, window: { from, to, splitAt }, thresholds: rule.thresholds });
      await withWorkspace(params.pool, params.workspaceId, async (tx) => {
        for (const f of findings) {
          const evidence = makeEvidence({ generatedBy: `${detector.name}@${rule.version}`, data: f.evidence });
          await tx.query(
            `INSERT INTO evidence (id, workspace_id, generated_by, data)
             VALUES ($1, NULLIF(current_setting('app.workspace_id', true), '')::uuid, $2, $3::jsonb)
             ON CONFLICT (id) DO NOTHING`,
            [evidence.id, evidence.generatedBy, JSON.stringify(evidence.data)],
          );
          const dedupeHash = createHash("sha256").update(`${detector.name}|${rule.version}|${f.entity}|${dayString(to)}`).digest("hex");
          const r = await tx.query(
            `INSERT INTO detector_findings
               (workspace_id, detector, detector_version, category, severity, priority, entity, confidence, data, evidence_id, occurred_at, dedupe_hash, run_id)
             VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
             ON CONFLICT (workspace_id, dedupe_hash) DO NOTHING`,
            [detector.name, rule.version, detector.category, f.severity, rule.priority, f.entity, f.confidence,
             JSON.stringify({ ...f.data, explanation: f.explanation }), evidence.id, to, dedupeHash, runId],
          );
          findingsCount += r.rowCount ?? 0;
        }
        await tx.query(
          `INSERT INTO detector_runs (id, workspace_id, detector, started_at, finished_at, status, window_from, window_to, findings_count, trace)
           VALUES ($1, NULLIF(current_setting('app.workspace_id', true), '')::uuid, $2, $3, now(), 'ok', $4, $5, $6, $7::jsonb)`,
          [runId, detector.name, startedAt, dayString(splitAt), dayString(to), findingsCount,
           JSON.stringify({ version: rule.version, thresholds: rule.thresholds, candidates: findings.length })],
        );
      });
      perDetector[detector.name] = findingsCount;
      total += findingsCount;
      params.metrics?.counter(`detection.findings.${detector.name}`).inc(findingsCount);
    } catch (error) {
      await withWorkspace(params.pool, params.workspaceId, (tx) =>
        tx.query(
          `INSERT INTO detector_runs (id, workspace_id, detector, finished_at, status, window_from, window_to, error)
           VALUES ($1, NULLIF(current_setting('app.workspace_id', true), '')::uuid, $2, now(), 'error', $3, $4, $5)`,
          [runId, detector.name, dayString(splitAt), dayString(to), error instanceof Error ? error.message : String(error)],
        ),
      );
      throw error;
    }
  }

  return { findings: total, perDetector, windowFrom: dayString(from), windowTo: dayString(to) };
}
