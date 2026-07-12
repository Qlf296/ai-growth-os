/** STEP 9.5 — Today digest report-backs: measured outcome with grade + evidence; never ROI/money. */
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Delivery, NotificationTypeRegistry } from "@aigos/delivery";
import { MagicLinkService, SessionService } from "@aigos/identity";
import { provisionOnSignIn, withWorkspace } from "@aigos/database";
import { recordOutcome } from "@aigos/analytics";

import { createWebServer } from "../src/server.js";
import { startHarness, type Harness } from "../../../packages/database/test/harness.js";

let h: Harness; let server: Server; let base: string; let sid = ""; let evidenceRef = "";
const DAY = "2026-07-12";

beforeAll(async () => {
  h = await startHarness();
  const sessions = new SessionService(h.app, () => new Date());
  const registry = new NotificationTypeRegistry();
  registry.register({ type: "security_transactional", channel: "email", dailyBudget: 0, cooldownSeconds: 0, budgetExempt: true });
  const delivery = new Delivery({ registry, channels: [{ channel: "email", send: async () => {} }], ledger: async () => {}, clock: () => new Date() });
  server = createWebServer({ pool: h.app, magic: new MagicLinkService(h.app, delivery, () => new Date(), { baseUrl: "https://x" }), sessions, clock: () => new Date("2026-07-12T09:00:00Z") });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address(); if (typeof addr === "string" || !addr) throw new Error("no addr");
  base = `http://127.0.0.1:${addr.port}`;
  const me = await provisionOnSignIn(h.app, "halim@test.dev");
  const ws = me.workspaces[0]!.id;
  sid = (await sessions.issue(me.userId, "node-other", "127.0.0.1")).sessionId;
  // an active opportunity (so the feed is non-empty) + a measured outcome (report-back)
  const evId = randomUUID();
  await withWorkspace(h.app, ws, async (tx) => {
    await tx.query(`INSERT INTO evidence (id, workspace_id, generated_by, data) VALUES ($1, NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'x@1', '{}'::jsonb)`, [evId]);
    const o = await tx.query(`INSERT INTO opportunities (workspace_id, entity, category, detectors, severity, confidence, impact, difficulty, effort, roi, priority_score, score_trace, evidence_ids, occurred_on, dedupe_hash) VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'https://forgcv.com/cv', 'seo', '[]'::jsonb, 'medium', 'high', 'medium', 'low', 'low', '{}'::jsonb, 0.7, '{}'::jsonb, $1::jsonb, $2, $3) RETURNING id`, [JSON.stringify([evId]), DAY, randomUUID()]);
    await tx.query(`INSERT INTO recommendations (workspace_id, opportunity_id, title, summary, business_reason, technical_reason, expected_impact, evidence_ids, affected_entities, prerequisites, steps, rollback) VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, 'Close CTR gap', 's', 'b', 't', 'clicks', $2::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'r')`, [o.rows[0].id, JSON.stringify([evId])]);
  });
  const r = await recordOutcome(h.app, ws, { subjectType: "opportunity", subjectId: randomUUID(), metric: "ctr", baselineValue: 0.02, observedValue: 0.03, windowDays: 28, targetImprovement: 0.1 });
  evidenceRef = r.evidenceReferenceId;
}, 120_000);

afterAll(async () => { await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))); await h.stop(); });

describe("Today report-backs", () => {
  it("shows measured outcome with verdict, grade and evidence; never money/ROI", async () => {
    const html = await (await fetch(`${base}/`, { headers: { "user-agent": "node", cookie: `sid=${sid}` }, redirect: "manual" })).text();
    expect(html).toContain("Recent results");
    expect(html).toContain("measured, not monetized");
    expect(html).toContain("ctr: met");
    expect(html).toContain("grade B");
    expect(html).toContain(evidenceRef); // I4
    expect(html).not.toMatch(/€|revenue|money saved|\$[0-9]/i);
  });
});
