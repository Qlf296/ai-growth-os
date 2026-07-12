/**
 * STEP 10.2 — production readiness checks: readiness/liveness separation,
 * critical-vs-optional dependency probes, graceful startup failure,
 * deterministic evidence-backed diagnostics.
 */
import { describe, expect, it } from "vitest";

import {
  ReadinessRegistry,
  assertReady,
  databaseProbe,
  redisProbe,
  aiGatewayProbe,
  liveness,
  type DependencyProbe,
} from "../src/index.js";

const up = (): Promise<void> => Promise.resolve();
const down = (): Promise<void> => Promise.reject(new Error("boom"));

const reg = (...probes: DependencyProbe[]): ReadinessRegistry => {
  const r = new ReadinessRegistry();
  for (const p of probes) r.register(p);
  return r;
};

describe("ReadinessRegistry", () => {
  it("is ready when every critical dependency is up", async () => {
    const report = await reg(databaseProbe(up), redisProbe(up), aiGatewayProbe(up)).check();
    expect(report.ready).toBe(true);
    expect(report.probes.map((p) => p.state)).toEqual(["up", "up", "up"]);
  });

  it("is not ready when a critical dependency is down (evidence names it)", async () => {
    const report = await reg(databaseProbe(down), redisProbe(up)).check();
    expect(report.ready).toBe(false);
    const db = report.probes.find((p) => p.name === "database");
    expect(db?.state).toBe("down");
    expect(db?.error).toContain("boom");
  });

  it("stays ready when an optional dependency is down", async () => {
    const optional: DependencyProbe = { name: "smtp", critical: false, check: () => down().then(() => true) };
    const report = await reg(databaseProbe(up), optional).check();
    expect(report.ready).toBe(true);
    expect(report.probes.find((p) => p.name === "smtp")?.state).toBe("down");
  });

  it("a throwing probe fails closed and never crashes the registry", async () => {
    const report = await reg(redisProbe(down)).check();
    expect(report.ready).toBe(false);
    expect(report.probes[0]?.state).toBe("down");
  });

  it("orders probes deterministically by name", async () => {
    const report = await reg(redisProbe(up), aiGatewayProbe(up), databaseProbe(up)).check();
    expect(report.probes.map((p) => p.name)).toEqual(["ai_gateway", "database", "redis"]);
  });

  it("produces a deterministic, timing-independent evidence id", async () => {
    const a = await reg(databaseProbe(up), redisProbe(up)).check();
    const b = await reg(redisProbe(up), databaseProbe(up)).check(); // different registration order
    expect(a.evidenceId).toBe(b.evidenceId);
    const c = await reg(databaseProbe(down), redisProbe(up)).check();
    expect(c.evidenceId).not.toBe(a.evidenceId); // state change → new evidence
  });
});

describe("liveness / readiness separation", () => {
  it("liveness reports the process is alive regardless of dependencies", async () => {
    const readiness = await reg(databaseProbe(down)).check();
    expect(readiness.ready).toBe(false);
    expect(liveness().live).toBe(true); // process is up even when a dependency is down
  });
});

describe("assertReady (graceful startup failure)", () => {
  it("throws naming the failed critical dependencies", async () => {
    await expect(assertReady(reg(databaseProbe(down), redisProbe(up)))).rejects.toThrow(/database/);
  });

  it("returns the report when everything critical is up", async () => {
    const report = await assertReady(reg(databaseProbe(up)));
    expect(report.ready).toBe(true);
  });
});
