/**
 * GSC ingestion job handler (family gsc.ingest.daily).
 * Pipeline per job: quota citizenship (ADR-021 §2) → raw-first ingest
 * (idempotent: deterministic raw key + signal dedupe) → workspace audit →
 * metrics. Failures stay typed; the queue owns retries and the DLQ.
 */
import type pg from "pg";

import {
  GscValidationError,
  classifyError,
  healthForErrorKind,
  ingestSearchAnalytics,
  type GscTransport,
  type QuotaGuard,
} from "@aigos/adapters";
import { int, type ConfigRegistry } from "@aigos/config-registry";
import { getSyncState, recordJobRun, updateConnectionHealth, updateSyncState, withWorkspace } from "@aigos/database";
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
const dayUtc = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);

/**
 * Incremental GSC synchronization (family gsc.ingest.daily).
 * Watermark-driven: sync from the day after last_successful_sync up to the
 * lagged target day, paginating each day to completion. Quota-gated per page.
 * Interruptions resume without data loss (watermark only advances on full
 * success; raw is immutable and signals dedupe). Persists sync metadata and
 * schedules the next run via the existing scheduler row.
 */
export function createGscIngestionHandler(deps: IngestionDeps) {
  return async (job: { jobId: string; payload: SchedulerPayload }): Promise<void> => {
    const payload = job.payload as IngestionJobPayload;
    const { workspaceId, connectionId, siteUrl } = payload.params;

    await deps.metrics.span("ingest.run_ms", async () => {
      const startedAt = Date.now();
      const scheduledFor = new Date(payload.scheduledFor);
      const lagDays = await deps.config.get<number>("adapters.gsc.data_lag_days_runtime");
      const targetDay = dayUtc(dayString(addDays(scheduledFor, -lagDays)));

      const state = await getSyncState(deps.pool, workspaceId, connectionId);
      const firstDay = state?.lastSuccessfulSync
        ? dayUtc(dayString(addDays(state.lastSuccessfulSync, 1)))
        : targetDay; // first run: just the target day
      await updateSyncState(deps.pool, workspaceId, connectionId, { lastAttemptedSync: scheduledFor });

      if (firstDay.getTime() > targetDay.getTime()) {
        deps.metrics.counter("ingest.up_to_date").inc();
        await recordJobRun(deps.pool, workspaceId, "gsc.ingest.daily", "up_to_date", addDays(scheduledFor, 1));
        return;
      }

      const beforeCall = async (): Promise<void> => {
        try {
          await deps.quota.acquire("gsc", workspaceId);
        } catch (error) {
          deps.metrics.counter("ingest.quota_denied").inc();
          throw error;
        }
      };

      let inserted = 0;
      let duplicates = 0;
      let apiCalls = 0;
      try {
        for (let day = firstDay; day.getTime() <= targetDay.getTime(); day = addDays(day, 1)) {
          const iso = dayString(day);
          const result = await ingestSearchAnalytics(
            {
              pool: deps.pool,
              rawStore: deps.rawStore,
              transport: deps.transport,
              workspaceId,
              connectionId,
              siteUrl,
              startDate: iso,
              endDate: iso,
              capturedAt: day, // deterministic raw key per day → idempotent resume
            },
            beforeCall,
          );
          inserted += result.inserted;
          duplicates += result.duplicates;
          apiCalls += result.apiCalls;
        }
      } catch (error) {
        if (error instanceof GscValidationError) deps.metrics.counter("ingest.validation_failed").inc();
        await updateSyncState(deps.pool, workspaceId, connectionId, {
          lastAttemptedSync: scheduledFor,
          addImportedRows: inserted,
          addApiQuotaUsed: apiCalls,
          lastError: error instanceof Error ? error.message : String(error),
        });
        // Health lifecycle: transient/quota → degraded, auth → reconnect_required, revoked → failed.
        const health = healthForErrorKind(classifyError(error).kind);
        const t = await updateConnectionHealth(deps.pool, workspaceId, connectionId, health, "sync failure");
        deps.metrics.counter(`connection.health.${t.to}`).inc();
        throw error; // bounded retries + DLQ are the queue's job; watermark unchanged → safe resume
      }

      // Success: advance the watermark, clear the error, record metadata + health.
      await updateSyncState(deps.pool, workspaceId, connectionId, {
        lastSuccessfulSync: targetDay,
        lastAttemptedSync: scheduledFor,
        lastDurationMs: Date.now() - startedAt,
        addImportedRows: inserted,
        addApiQuotaUsed: apiCalls,
        lastError: null,
      });
      deps.metrics.counter("ingest.signals_inserted").inc(inserted);
      const t = await updateConnectionHealth(deps.pool, workspaceId, connectionId, "healthy", "sync ok");
      deps.metrics.counter(`connection.health.${t.to}`).inc();
      await withWorkspace(deps.pool, workspaceId, async (tx) => {
        await tx.query(`UPDATE connections SET health_checked_at = now() WHERE id = $1`, [connectionId]);
        await tx.query(
          `INSERT INTO audit_log (workspace_id, actor, event, details) VALUES ($1, 'worker', 'ingestion.completed', $2::jsonb)`,
          [workspaceId, JSON.stringify({
            provider: "gsc", jobId: job.jobId, inserted, duplicates, apiCalls,
            window: { from: dayString(firstDay), to: dayString(targetDay) },
          })],
        );
      });
      await recordJobRun(deps.pool, workspaceId, "gsc.ingest.daily", "ok", addDays(scheduledFor, 1));
    });
  };
}
