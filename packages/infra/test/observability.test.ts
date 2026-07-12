/**
 * Observability skeleton (ADR-047; PERFORMANCE_BUDGET; S18 log hygiene).
 * The scrub test here is the runtime half of AT-8(2): tokens, emails and
 * magic links fed through the logger must never appear in output.
 */
import { describe, expect, it } from "vitest";

import {
  HealthRegistry,
  Logger,
  MetricsRegistry,
  evaluateSlo,
  type SloDefinition,
} from "../src/index.js";

describe("structured logging + scrubbing (AT-8 runtime half)", () => {
  const capture = () => {
    const lines: string[] = [];
    const logger = new Logger({ sink: (line) => void lines.push(line), context: { app: "test" } });
    return { lines, logger };
  };

  it("emits one JSON line with level, msg, timestamp and context", () => {
    const { lines, logger } = capture();
    logger.info("api listening", { port: 3000 });
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({ level: "info", msg: "api listening", port: 3000, app: "test" });
    expect(typeof entry.at).toBe("string");
  });

  it("NEVER lets a provider token, email, magic link or long hex secret through", () => {
    const { lines, logger } = capture();
    const secret = "a".repeat(64);
    logger.error("oauth refresh failed", {
      email: "halim@test.dev",
      url: `https://app.dev/auth/confirm?token=${secret}`,
      enc_access_token: "ya29.A0AfB_byDEADBEEF",
      nested: { refresh_token: "1//0gSECRET", note: "user halim@test.dev reported" },
    });
    const out = lines.join("\n");
    expect(out).not.toContain(secret);
    expect(out).not.toContain("halim@test.dev");
    expect(out).not.toContain("ya29.A0AfB_byDEADBEEF");
    expect(out).not.toContain("1//0gSECRET");
    expect(out).toContain("[REDACTED]");
  });

  it("child loggers inherit and extend context", () => {
    const { lines, logger } = capture();
    logger.child({ module: "delivery" }).warn("suppressed", { reason: "budget" });
    expect(JSON.parse(lines[0]!)).toMatchObject({ app: "test", module: "delivery", reason: "budget" });
  });
});

describe("metrics", () => {
  it("counters, gauges and histogram p95 snapshots", () => {
    const m = new MetricsRegistry();
    m.counter("queue.dead_letters").inc();
    m.counter("queue.dead_letters").inc();
    m.gauge("queue.lag_seconds").set(12);
    const h = m.histogram("feed.load_ms");
    for (let i = 1; i <= 100; i++) h.observe(i * 10); // 10..1000
    const snap = m.snapshot();
    expect(snap.counters["queue.dead_letters"]).toBe(2);
    expect(snap.gauges["queue.lag_seconds"]).toBe(12);
    expect(snap.histograms["feed.load_ms"]?.p95).toBe(950);
    expect(snap.histograms["feed.load_ms"]?.count).toBe(100);
  });

  it("span() times a block into the named histogram", async () => {
    const m = new MetricsRegistry();
    const result = await m.span("job.run_ms", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return "done";
    });
    expect(result).toBe("done");
    expect(m.snapshot().histograms["job.run_ms"]?.count).toBe(1);
    expect(m.snapshot().histograms["job.run_ms"]?.p95).toBeGreaterThan(0);
  });
});

describe("SLO evaluation (ADR-047 states; PERFORMANCE_BUDGET margin rule)", () => {
  const slo: SloDefinition = {
    name: "today_feed_load",
    owner: "recommendation", // every SLI has an owner (ADR-047)
    histogram: "feed.load_ms",
    p95TargetMs: 800,
    segmentBudgetMs: 500, // sum of owned segments; margin is the rest
  };

  const withP95 = (ms: number) => {
    const m = new MetricsRegistry();
    m.histogram("feed.load_ms").observe(ms);
    return m.snapshot();
  };

  it("ok when under segment budget", () => {
    expect(evaluateSlo(slo, withP95(400))).toEqual({ name: "today_feed_load", state: "ok", p95: 400 });
  });

  it("degraded when the margin is being consumed, even though the SLO still passes", () => {
    expect(evaluateSlo(slo, withP95(700)).state).toBe("degraded"); // 700 > 500 budget, < 800 SLO
  });

  it("breach when the SLO ceiling is crossed", () => {
    expect(evaluateSlo(slo, withP95(900)).state).toBe("breach");
  });

  it("no data = unknown, never a silent ok", () => {
    expect(evaluateSlo(slo, new MetricsRegistry().snapshot()).state).toBe("unknown");
  });
});

describe("health checks", () => {
  it("aggregates registered checks; any failure flips global status", async () => {
    const h = new HealthRegistry();
    h.register("db", async () => true);
    h.register("redis", async () => false);
    const report = await h.run();
    expect(report).toEqual({ healthy: false, checks: { db: true, redis: false } });
  });

  it("a throwing check is a failure, not a crash", async () => {
    const h = new HealthRegistry();
    h.register("s3", async () => {
      throw new Error("timeout");
    });
    expect((await h.run()).checks.s3).toBe(false);
  });
});
