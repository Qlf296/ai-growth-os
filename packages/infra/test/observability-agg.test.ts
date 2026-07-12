/**
 * STEP 10.6 — tracing context propagation + operational diagnostics
 * aggregation. Reuses the existing Logger/Metrics/SLO/Readiness (no duplicated
 * logging or metric logic): tracing only produces fields the Logger already
 * understands, and diagnostics only composes existing snapshots.
 */
import { describe, expect, it } from "vitest";

import {
  AuditAggregator,
  Logger,
  MetricsRegistry,
  ReadinessRegistry,
  aiGatewayProbe,
  childSpan,
  collectDiagnostics,
  continueTrace,
  databaseProbe,
  newTrace,
  redisProbe,
  traceFields,
  type SloDefinition,
} from "../src/index.js";

const seqGen = () => {
  let n = 0;
  return () => `id${n++}`;
};

describe("tracing context", () => {
  it("newTrace creates a root span with a fresh trace id and no parent", () => {
    const ctx = newTrace(seqGen());
    expect(ctx).toEqual({ traceId: "id0", spanId: "id1" });
  });

  it("childSpan keeps the trace id and links to the parent span", () => {
    const gen = seqGen();
    const root = newTrace(gen);
    const child = childSpan(root, gen);
    expect(child.traceId).toBe(root.traceId);
    expect(child.parentSpanId).toBe(root.spanId);
    expect(child.spanId).not.toBe(root.spanId);
  });

  it("continueTrace adopts an inbound correlation id as the trace id", () => {
    const ctx = continueTrace("req-abc", seqGen());
    expect(ctx.traceId).toBe("req-abc");
    expect(ctx.parentSpanId).toBeUndefined();
  });

  it("propagates into the existing Logger via child() (no new logging path)", () => {
    const lines: string[] = [];
    const log = new Logger({ sink: (l) => lines.push(l), clock: () => new Date("2026-07-12T00:00:00Z") });
    const ctx = newTrace(seqGen());
    log.child(traceFields(ctx)).info("handled");
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry.trace_id).toBe("id0");
    expect(entry.span_id).toBe("id1");
  });
});

const slos: SloDefinition[] = [
  { name: "feed", owner: "recommendation", histogram: "feed.load_ms", p95TargetMs: 800, segmentBudgetMs: 500 },
];

describe("collectDiagnostics", () => {
  const readiness = async (dbUp: boolean) => {
    const reg = new ReadinessRegistry();
    reg.register(databaseProbe(() => (dbUp ? Promise.resolve() : Promise.reject(new Error("down")))));
    reg.register(redisProbe(() => Promise.resolve()));
    reg.register(aiGatewayProbe(() => Promise.resolve()));
    return reg.check();
  };

  it("aggregates readiness, SLOs and metrics; healthy when ready and SLOs ok", async () => {
    const metrics = new MetricsRegistry();
    metrics.histogram("feed.load_ms").observe(400); // under budget
    const report = collectDiagnostics({
      readiness: await readiness(true),
      metrics: metrics.snapshot(),
      slos,
      clock: () => new Date("2026-07-12T00:00:00Z"),
    });
    expect(report.live).toBe(true);
    expect(report.ready).toBe(true);
    expect(report.slos.map((s) => s.state)).toEqual(["ok"]);
    expect(report.healthy).toBe(true);
    expect(report.at).toBe("2026-07-12T00:00:00.000Z");
  });

  it("is unhealthy when a critical dependency is down", async () => {
    const report = collectDiagnostics({ readiness: await readiness(false), metrics: new MetricsRegistry().snapshot(), slos });
    expect(report.ready).toBe(false);
    expect(report.healthy).toBe(false);
  });

  it("is unhealthy when an SLO breaches even though dependencies are ready", async () => {
    const metrics = new MetricsRegistry();
    metrics.histogram("feed.load_ms").observe(2000); // over target → breach
    const report = collectDiagnostics({ readiness: await readiness(true), metrics: metrics.snapshot(), slos });
    expect(report.ready).toBe(true);
    expect(report.slos[0]?.state).toBe("breach");
    expect(report.healthy).toBe(false);
  });
});

describe("AuditAggregator", () => {
  it("folds audit events into counts per action, sorted, with a total", () => {
    const agg = new AuditAggregator();
    agg.record({ action: "opportunity.transition" });
    agg.record({ action: "learning.propagated" });
    agg.record({ action: "opportunity.transition" });
    expect(agg.counts()).toEqual([
      { action: "learning.propagated", count: 1 },
      { action: "opportunity.transition", count: 2 },
    ]);
    expect(agg.total()).toBe(3);
  });
})
