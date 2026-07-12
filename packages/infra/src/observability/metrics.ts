/**
 * In-process metrics (ADR-047 SLIs): counters, gauges, histograms with p95.
 * Plain snapshot export — a Prometheus/OTel exporter can render it later;
 * no external platform now. span() is the minimal tracing surface: every
 * timed block lands in a histogram an SLO can read.
 */

class Counter {
  value = 0;
  inc(by = 1): void { this.value += by; }
}

class Gauge {
  value = 0;
  set(value: number): void { this.value = value; }
}

class Histogram {
  private readonly samples: number[] = [];
  observe(value: number): void { this.samples.push(value); }
  snapshot(): { count: number; p95: number } {
    if (this.samples.length === 0) return { count: 0, p95: 0 };
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return { count: sorted.length, p95: sorted[idx]! };
  }
}

export interface MetricsSnapshot {
  readonly counters: Record<string, number>;
  readonly gauges: Record<string, number>;
  readonly histograms: Record<string, { count: number; p95: number }>;
}

export class MetricsRegistry {
  private readonly counters = new Map<string, Counter>();
  private readonly gauges = new Map<string, Gauge>();
  private readonly histograms = new Map<string, Histogram>();

  counter(name: string): Counter {
    let c = this.counters.get(name);
    if (!c) { c = new Counter(); this.counters.set(name, c); }
    return c;
  }

  gauge(name: string): Gauge {
    let g = this.gauges.get(name);
    if (!g) { g = new Gauge(); this.gauges.set(name, g); }
    return g;
  }

  histogram(name: string): Histogram {
    let h = this.histograms.get(name);
    if (!h) { h = new Histogram(); this.histograms.set(name, h); }
    return h;
  }

  /** Minimal tracing: time a block into a histogram. */
  async span<T>(histogramName: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.histogram(histogramName).observe(performance.now() - start);
    }
  }

  snapshot(): MetricsSnapshot {
    return {
      counters: Object.fromEntries([...this.counters].map(([k, v]) => [k, v.value])),
      gauges: Object.fromEntries([...this.gauges].map(([k, v]) => [k, v.value])),
      histograms: Object.fromEntries([...this.histograms].map(([k, v]) => [k, v.snapshot()])),
    };
  }
}
