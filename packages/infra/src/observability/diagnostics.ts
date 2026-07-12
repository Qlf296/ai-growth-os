/**
 * Operational diagnostics aggregation (STEP 10.6) — the health-dashboard
 * backend. Pure composition of the existing signals (readiness probes, SLO
 * evaluation, metrics snapshot); it computes nothing new and owns no state, so
 * there is no duplicated observability logic. `healthy` = ready AND no SLO
 * breach (a degraded SLO is surfaced but does not fail health).
 */
import { evaluateSlo, LAUNCH_SLOS, type SloDefinition, type SloResult } from "./slo.js";
import type { MetricsSnapshot } from "./metrics.js";
import type { ProbeResult, ReadinessReport } from "./readiness.js";

export interface DiagnosticsReport {
  readonly at: string;
  readonly live: boolean;
  readonly ready: boolean;
  readonly healthy: boolean;
  readonly probes: readonly ProbeResult[];
  readonly slos: readonly SloResult[];
  readonly metrics: MetricsSnapshot;
  readonly evidenceId: string;
}

export interface DiagnosticsInputs {
  readonly readiness: ReadinessReport;
  readonly metrics: MetricsSnapshot;
  readonly slos?: readonly SloDefinition[];
  readonly clock?: () => Date;
}

export function collectDiagnostics(inputs: DiagnosticsInputs): DiagnosticsReport {
  const slos = (inputs.slos ?? LAUNCH_SLOS).map((slo) => evaluateSlo(slo, inputs.metrics));
  const breach = slos.some((s) => s.state === "breach");
  const at = (inputs.clock ?? (() => new Date()))().toISOString();
  return {
    at,
    live: true, // the process is executing this code
    ready: inputs.readiness.ready,
    healthy: inputs.readiness.ready && !breach,
    probes: inputs.readiness.probes,
    slos,
    metrics: inputs.metrics,
    evidenceId: inputs.readiness.evidenceId, // ties the diagnostics to the readiness evidence (I4)
  };
}

export interface AuditEvent {
  readonly action: string;
}

export interface AuditCount {
  readonly action: string;
  readonly count: number;
}

/** Pure reducer over the audit stream — operational counts only, never a writer (I5 intact). */
export class AuditAggregator {
  private readonly byAction = new Map<string, number>();

  record(event: AuditEvent): void {
    this.byAction.set(event.action, (this.byAction.get(event.action) ?? 0) + 1);
  }

  counts(): AuditCount[] {
    return [...this.byAction.entries()]
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => a.action.localeCompare(b.action));
  }

  total(): number {
    return this.counts().reduce((sum, c) => sum + c.count, 0);
  }
}
