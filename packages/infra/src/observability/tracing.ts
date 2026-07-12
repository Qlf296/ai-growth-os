/**
 * Trace context propagation (STEP 10.6). A trace groups the spans of one
 * logical operation across api → worker → gateway; a correlation/request id
 * from the edge becomes the trace id so a single request is followable end to
 * end. Tracing produces *fields only* — it feeds the existing Logger.child()
 * and Metrics.span(); it adds no second logging or metric path (ADR-047).
 */
import { randomUUID } from "node:crypto";

export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
}

type IdGen = () => string;

/** Start a brand-new trace with a root span. */
export function newTrace(gen: IdGen = randomUUID): TraceContext {
  return { traceId: gen(), spanId: gen() };
}

/** Continue an inbound trace (e.g. an X-Request-Id / correlation id) as root. */
export function continueTrace(traceId: string, gen: IdGen = randomUUID): TraceContext {
  return { traceId, spanId: gen() };
}

/** A child span under `parent`, sharing the trace id and linking to the parent span. */
export function childSpan(parent: TraceContext, gen: IdGen = randomUUID): TraceContext {
  return { traceId: parent.traceId, spanId: gen(), parentSpanId: parent.spanId };
}

/** Log/propagation fields for a trace context — consumed by Logger.child(). */
export function traceFields(ctx: TraceContext): Record<string, string> {
  return {
    trace_id: ctx.traceId,
    span_id: ctx.spanId,
    ...(ctx.parentSpanId ? { parent_span_id: ctx.parentSpanId } : {}),
  };
}
