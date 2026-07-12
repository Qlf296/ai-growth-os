/**
 * GSC ingestion job handler (family gsc.ingest.daily).
 * Pipeline per job: quota citizenship (ADR-021 §2) → raw-first ingest
 * (idempotent: deterministic raw key + signal dedupe) → workspace audit →
 * metrics. Failures stay typed; the queue owns retries and the DLQ.
 */
import type pg from "pg";

import {
  GscValidationError,
  ingestSearchAnalytics,
  type GscTransport,
  type QuotaGuard,
} from "@aigos/adapters";
import { int, type ConfigRegistry } from "@aigos/config-registry";
import { withWorkspace } from "@aigos/database";
import type { MetricsRegistry, RawStore } from "@aigos/infra";

import type { SchedulerPayload } from "./scheduler.js";

export interface IngestionJobPayload extends SchedulerPayload {
  readonly params: { workspaceId: string; connectionId: string; siteUrl: string };
}

export interface IngestionDeps {
  readonly pool: pg.Pool;
  readonly rawStore: RawStore;
  transport: GscTransport;
  readonly config: ConfigRegistry;
  readonly metrics: MetricsRegistry;
  readonly quota: QuotaGuard;
}

/** GSC quota tunables (ADR-046) — conservative defaults, ops-tunable, not decision-affecting. */
export function registerGscQuotaKeys(config: ConfigRegistry): void {
  config.define({
    key: "adapters.gsc.quota_global_per_minute",
    description: "App-global GSC calls/min (ADR-021 §2 token bucket, outer layer)",
    owner: "ingestion",
    stability: "experiment",
    decisionAffecting: false,
    schema: int({ min: 0, max: 10_000 }),
    defaultValue: 100,
  });
  config.define({
    key: "adapters.gsc.quota_per_workspace_per_minute",
    description: "Per-workspace fairness share (inner layer)",
    owner: "ingestion",
    stability: "experiment",
    decisionAffecting: false,
    schema: int({ min: 0, max: 1_000 }),
    defaultValue: 10,
  });
  config.define({
    key: "adapters.gsc.data_lag_days_runtime",
    description: "Ingestion window lag — GSC data lags ~2 days (S7 §1.1)",
    owner: "ingestion",
    stability: "stable",
    decisionAffecting: false,
    schema: int({ min: 0, max: 14 }),
    defaultValue: 2,
  });
}

const dayString = (d: Date): string => d.toISOString().slice(0, 10);

export function createGscIngestionHandler(deps: IngestionDeps) {
  return async (job: { jobId: string; payload: SchedulerPayload }): Promise<void> => {
    const payload = job.payload as IngestionJobPayload;
    const { workspaceId, connectionId, siteUrl } = payload.params;

    await deps.metrics.span("ingest.run_ms", async () => {
      try {
        await deps.quota.acquire("gsc", workspaceId);
      } catch (error) {
        deps.metrics.counter("ingest.quota_denied").inc();
        throw error; // bounded retries + DLQ are the queue's job
      }

      const scheduledFor = new Date(payload.scheduledFor);
      const lagDays = await deps.config.get<number>("adapters.gsc.data_lag_days_runtime");
      const day = new Date(scheduledFor.getTime() - lagDays * 86_400_000);

      let result;
      try {
        result = await ingestSearchAnalytics({
          pool: deps.pool,
          rawStore: deps.rawStore,
          transport: deps.transport,
          workspaceId,
          connectionId,
          siteUrl,
          startDate: dayString(day),
          endDate: dayString(day),
          capturedAt: scheduledFor, // deterministic raw key → idempotent re-execution
        });
      } catch (error) {
        if (error instanceof Error && /immutable/.test(error.message)) {
          // Raw already captured by a previous attempt — first capture wins (raw-first).
          deps.metrics.counter("ingest.raw_already_captured").inc();
          return;
        }
        if (error instanceof GscValidationError) {
          deps.metrics.counter("ingest.validation_failed").inc();
        }
        throw error;
      }

      deps.metrics.counter("ingest.signals_inserted").inc(result.inserted);
      await withWorkspace(deps.pool, workspaceId, (tx) =>
        tx.query(
          `INSERT INTO audit_log (workspace_id, actor, event, details) VALUES ($1, 'worker', 'ingestion.completed', $2::jsonb)`,
          [workspaceId, JSON.stringify({
            provider: "gsc", jobId: job.jobId, inserted: result.inserted,
            duplicates: result.duplicates, rawRef: result.rawRef, window: dayString(day),
          })],
        ),
      );
    });
  };
}
