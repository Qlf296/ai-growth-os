/** STEP 3.2/3.4/3.6 — detection engine on real Postgres: rules-as-data, evidence (I4), idempotent replay, RLS. */
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConnectionRepository, SignalRepository, withWorkspace } from "@aigos/database";
import { MetricsRegistry } from "@aigos/infra";

import { loadRules, runDetection, setWorkspaceRule } from "../src/index.js";
import { startHarness, seedWorkspace, type Harness } from "../../database/test/harness.js";

let h: Harness;
const WS = randomUUID();
const OTHER = randomUUID();
const USER = randomUUID();
let connectionId = "";
const NOW = new Date("2026-06-15T00:00:00Z");

/** Seed daily search-analytics signals for a page across a date range. */
async function seedSignal(ws: string, page: string, date: string, o: { clicks: number; impressions: number; position: number }): Promise<void> {
  const externalId = `${date}|q|${page}`;
  await withWorkspace(h.app, ws, (tx) =>
    new SignalRepository().insertMany(tx, [{
      connectionId, source: "gsc", type: "gsc.search_analytics.daily", externalId,
      occurredAt: new Date(`${date}T00:00:00Z`), payloadRef: `${ws}/gsc/${date}/x`,
      data: { page, query: "q", clicks: o.clicks, impressions: o.impressions, ctr: o.impressions ? o.clicks / o.impressions : 0, position: o.position },
      normalizerVersion: 1, dedupeHash: createHash("sha256").update(`gsc|daily|${externalId}`).digest("hex"),
    }]),
  );
}

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  await seedWorkspace(h.admin, OTHER, "other");
  await h.admin.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@t.dev', 'magic_link')`, [USER]);
  connectionId = await withWorkspace(h.app, WS, (tx) =>
    new ConnectionRepository().create(tx, { provider: "gsc", scopes: [], capabilities: {}, authorizedBy: USER }),
  );
  // recent window (2026-06-08..14): striking-distance page + a drop page
  for (const d of ["2026-06-09", "2026-06-11", "2026-06-13"]) {
    await seedSignal(WS, "https://forgcv.com/cv", d, { clicks: 5, impressions: 300, position: 12 }); // striking distance
    await seedSignal(WS, "https://forgcv.com/decay", d, { clicks: 2, impressions: 40, position: 6 });  // recent low
  }
  // prior window (2026-06-01..07): decay page was strong
  for (const d of ["2026-06-02", "2026-06-04", "2026-06-06"]) {
    await seedSignal(WS, "https://forgcv.com/decay", d, { clicks: 40, impressions: 500, position: 6 });
  }
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe("rules as data", () => {
  it("loads global defaults; a workspace override wins", async () => {
    const globals = await loadRules(h.app, WS);
    expect(globals.get("seo.striking_distance")?.enabled).toBe(true);
    await setWorkspaceRule(h.app, WS, { detector: "seo.ctr_gap", enabled: false, priority: 20, version: 1, thresholds: {} });
    const overridden = await loadRules(h.app, WS);
    expect(overridden.get("seo.ctr_gap")?.enabled).toBe(false);
    // re-enable for the detection run below
    await setWorkspaceRule(h.app, WS, { detector: "seo.ctr_gap", enabled: true, priority: 20, version: 1, thresholds: { impressions_floor: 100, min_gap: 0.3 } });
  });
});

describe("runDetection", () => {
  it("produces findings with mandatory evidence (I4) and a per-detector run trace", async () => {
    const metrics = new MetricsRegistry();
    const summary = await runDetection({ pool: h.app, workspaceId: WS, now: NOW, windowDays: 7, metrics });
    expect(summary.findings).toBeGreaterThan(0);

    const findings = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT detector, entity, evidence_id, severity, confidence, data FROM detector_findings ORDER BY detector, entity`));
    expect(findings.rowCount).toBe(summary.findings);
    // I4: every finding references an existing evidence row
    for (const row of findings.rows as Array<{ evidence_id: string }>) {
      const ev = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT id FROM evidence WHERE id = $1`, [row.evidence_id]));
      expect(ev.rowCount).toBe(1);
    }
    expect(findings.rows.some((r: { detector: string }) => r.detector === "seo.striking_distance")).toBe(true);
    expect(findings.rows.some((r: { detector: string }) => r.detector === "seo.impression_drop")).toBe(true);

    const runs = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT status, findings_count FROM detector_runs`));
    expect(runs.rowCount).toBe(4); // one per enabled detector
    expect(runs.rows.every((r: { status: string }) => r.status === "ok")).toBe(true);
  });

  it("is idempotent — replay of the same window adds no new findings or evidence", async () => {
    const f0 = (await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n FROM detector_findings`))).rows[0].n;
    const e0 = (await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n FROM evidence`))).rows[0].n;
    await runDetection({ pool: h.app, workspaceId: WS, now: NOW, windowDays: 7 });
    const f1 = (await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n FROM detector_findings`))).rows[0].n;
    const e1 = (await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n FROM evidence`))).rows[0].n;
    expect(f1).toBe(f0);
    expect(e1).toBe(e0);
  });

  it("RLS: another workspace sees no findings or evidence", async () => {
    expect((await withWorkspace(h.app, OTHER, (tx) => tx.query(`SELECT * FROM detector_findings`))).rowCount).toBe(0);
    expect((await withWorkspace(h.app, OTHER, (tx) => tx.query(`SELECT * FROM evidence`))).rowCount).toBe(0);
  });

  it("a disabled detector produces nothing", async () => {
    const fresh = randomUUID();
    await seedWorkspace(h.admin, fresh, "fresh");
    await setWorkspaceRule(h.app, fresh, { detector: "seo.striking_distance", enabled: false, priority: 10, version: 1, thresholds: {} });
    const summary = await runDetection({ pool: h.app, workspaceId: fresh, now: NOW });
    expect(summary.perDetector["seo.striking_distance"]).toBeUndefined();
  });
});
