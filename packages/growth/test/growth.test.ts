/** STEP 4.1/4.4/4.5/4.6 — growth build, lifecycle, feed on real Postgres: idempotent, evidence-backed, RLS. */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConfigRegistry, InMemoryConfigStore } from "@aigos/config-registry";
import { withWorkspace } from "@aigos/database";

import { buildFeed, buildGrowth, registerGrowthWeights, transitionOpportunity } from "../src/index.js";
import { startHarness, seedWorkspace, type Harness } from "../../database/test/harness.js";

let h: Harness;
let config: ConfigRegistry;
const WS = randomUUID();
const OTHER = randomUUID();
const DAY = "2026-06-15";

async function seedFinding(ws: string, entity: string, detector: string, severity: string, confidence: string): Promise<void> {
  const evidenceId = randomUUID();
  await withWorkspace(h.app, ws, async (tx) => {
    await tx.query(
      `INSERT INTO evidence (id, workspace_id, generated_by, data)
       VALUES ($1, NULLIF(current_setting('app.workspace_id', true), '')::uuid, $2, '{"metric":"x","value":1}'::jsonb)`,
      [evidenceId, `${detector}@1`],
    );
    await tx.query(
      `INSERT INTO detector_findings (workspace_id, detector, detector_version, category, severity, priority, entity, confidence, data, evidence_id, occurred_at, dedupe_hash, run_id)
       VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, 1, 'seo', $2, 10, $3, $4, '{}'::jsonb, $5, $6, $7, $8)`,
      [detector, severity, entity, confidence, evidenceId, `${DAY}T00:00:00Z`, randomUUID(), randomUUID()],
    );
  });
}

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  await seedWorkspace(h.admin, OTHER, "other");
  config = new ConfigRegistry(new InMemoryConfigStore());
  registerGrowthWeights(config);
  await seedFinding(WS, "https://forgcv.com/cv", "seo.striking_distance", "info", "high");
  await seedFinding(WS, "https://forgcv.com/cv", "seo.impression_drop", "medium", "high"); // same page → grouped
  await seedFinding(WS, "https://forgcv.com/blog", "seo.ctr_gap", "low", "medium");
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe("buildGrowth", () => {
  it("creates one opportunity per page with a recommendation, evidence and a scoring trace", async () => {
    const summary = await buildGrowth({ pool: h.app, config, workspaceId: WS, day: DAY });
    expect(summary.opportunities).toBe(2); // cv (grouped) + blog
    expect(summary.recommendations).toBe(2);
    const opps = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT entity, severity, detectors, priority_score, score_trace, evidence_ids, status FROM opportunities ORDER BY entity`));
    const cv = opps.rows.find((r: { entity: string }) => r.entity.endsWith("/cv"))!;
    expect(cv.severity).toBe("medium"); // dominant
    expect(cv.detectors).toEqual(["seo.impression_drop", "seo.striking_distance"]);
    expect(Number(cv.priority_score)).toBeGreaterThan(0);
    expect(cv.score_trace.weights).toBeDefined();
    expect(cv.evidence_ids.length).toBe(2); // I4: union of evidence
    expect(cv.status).toBe("detected");
    const recs = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n FROM recommendations`));
    expect(recs.rows[0].n).toBe(2);
  });

  it("is idempotent — re-running the same day creates no duplicate opportunities/recommendations", async () => {
    const before = (await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n FROM opportunities`))).rows[0].n;
    await buildGrowth({ pool: h.app, config, workspaceId: WS, day: DAY });
    const after = (await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n FROM opportunities`))).rows[0].n;
    expect(after).toBe(before);
  });

  it("RLS: another workspace sees no opportunities or recommendations", async () => {
    expect((await withWorkspace(h.app, OTHER, (tx) => tx.query(`SELECT * FROM opportunities`))).rowCount).toBe(0);
    expect((await withWorkspace(h.app, OTHER, (tx) => tx.query(`SELECT * FROM recommendations`))).rowCount).toBe(0);
  });
});

describe("daily feed", () => {
  it("orders by priority (grouped by category) and paginates deterministically", async () => {
    const p1 = await buildFeed(h.app, WS, DAY, { page: 1, pageSize: 1 });
    expect(p1.total).toBe(2);
    expect(p1.items).toHaveLength(1);
    expect(p1.items[0]!.recommendation).not.toBeNull();
    const p2 = await buildFeed(h.app, WS, DAY, { page: 2, pageSize: 1 });
    expect(p2.items[0]!.opportunityId).not.toBe(p1.items[0]!.opportunityId);
    // higher-priority page first (cv is medium severity → outranks blog low)
    expect(p1.items[0]!.entity.endsWith("/cv")).toBe(true);
    // replay: same inputs → same order
    const again = await buildFeed(h.app, WS, DAY, { page: 1, pageSize: 1 });
    expect(again.items[0]!.opportunityId).toBe(p1.items[0]!.opportunityId);
  });
});

describe("lifecycle", () => {
  it("audits every transition and rejects illegal jumps", async () => {
    const id = (await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT id FROM opportunities WHERE entity LIKE '%/blog' LIMIT 1`))).rows[0].id;
    await transitionOpportunity(h.app, WS, id, "validated", "looks real");
    await transitionOpportunity(h.app, WS, id, "accepted", "user accepted");
    await expect(transitionOpportunity(h.app, WS, id, "detected", "back")).rejects.toThrow(/illegal/);
    const audit = await h.admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE event = 'opportunity.transition' AND workspace_id = $1`, [WS]);
    expect(audit.rows[0].n).toBe(2);
    // accepted/rejected/completed are dropped from the feed
    const feed = await buildFeed(h.app, WS, DAY, { pageSize: 10 });
    expect(feed.items.some((i) => i.opportunityId === id)).toBe(false);
  });
});
