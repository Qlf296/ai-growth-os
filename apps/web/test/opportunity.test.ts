/** STEP 6.2 — opportunity detail page: repositories only, evidence cites evidenceReferenceId, immutable timeline. */
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Delivery, NotificationTypeRegistry } from "@aigos/delivery";
import { MagicLinkService, SessionService } from "@aigos/identity";
import { provisionOnSignIn, withWorkspace } from "@aigos/database";
import { transitionOpportunity } from "@aigos/growth";

import { createWebServer } from "../src/server.js";
import { startHarness, type Harness } from "../../../packages/database/test/harness.js";

let h: Harness;
let server: Server;
let base: string;
let sid = "";
let opportunityId = "";
let evidenceId = "";

beforeAll(async () => {
  h = await startHarness();
  const sessions = new SessionService(h.app, () => new Date());
  const registry = new NotificationTypeRegistry();
  registry.register({ type: "security_transactional", channel: "email", dailyBudget: 0, cooldownSeconds: 0, budgetExempt: true });
  const delivery = new Delivery({ registry, channels: [{ channel: "email", send: async () => {} }], ledger: async () => {}, clock: () => new Date() });
  server = createWebServer({ pool: h.app, magic: new MagicLinkService(h.app, delivery, () => new Date(), { baseUrl: "https://x" }), sessions, clock: () => new Date("2026-07-12T09:00:00Z") });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr === "string" || !addr) throw new Error("no addr");
  base = `http://127.0.0.1:${addr.port}`;

  const me = await provisionOnSignIn(h.app, "halim@test.dev");
  const ws = me.workspaces[0]!.id;
  sid = (await sessions.issue(me.userId, "node-other", "127.0.0.1")).sessionId;
  evidenceId = randomUUID();
  await withWorkspace(h.app, ws, async (tx) => {
    await tx.query(`INSERT INTO evidence (id, workspace_id, generated_by, data) VALUES ($1, NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'seo.ctr_gap@1', '{"metric":"ctr","value":0.01}'::jsonb)`, [evidenceId]);
    const o = await tx.query(
      `INSERT INTO opportunities (workspace_id, entity, category, detectors, severity, confidence, impact, difficulty, effort, roi, priority_score, score_trace, evidence_ids, occurred_on, dedupe_hash)
       VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'https://forgcv.com/cv', 'seo', '["seo.ctr_gap"]'::jsonb, 'medium', 'high', 'medium', 'low', 'low', '{}'::jsonb, 0.72, '{}'::jsonb, $1::jsonb, '2026-07-12', $2) RETURNING id`,
      [JSON.stringify([evidenceId]), randomUUID()],
    );
    opportunityId = o.rows[0].id;
    await tx.query(
      `INSERT INTO recommendations (workspace_id, opportunity_id, title, summary, business_reason, technical_reason, expected_impact, evidence_ids, affected_entities, prerequisites, steps, rollback)
       VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, 'Close the CTR gap', 'CTR below expectation', 'biz', 'tech', 'clicks', $2::jsonb, '["https://forgcv.com/cv"]'::jsonb, '[]'::jsonb, '["step one"]'::jsonb, 'revert')`,
      [opportunityId, JSON.stringify([evidenceId])],
    );
  });
  await transitionOpportunity(h.app, ws, opportunityId, "validated", "confirmed by data");
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await h.stop();
});

const get = (path: string) => fetch(`${base}${path}`, { headers: { "user-agent": "node", cookie: `sid=${sid}` }, redirect: "manual" });

describe("opportunity detail page", () => {
  it("renders details, recommendation, evidence (with evidenceReferenceId) and the immutable timeline", async () => {
    const html = await (await get(`/opportunities/${opportunityId}`)).text();
    expect(html).toContain("Close the CTR gap");            // recommendation
    expect(html).toContain("step one");                     // steps
    expect(html).toContain(evidenceId);                     // evidence cites its reference id (I4)
    expect(html).toContain("Evidence");
    expect(html).toContain("Status history");
    expect(html).toContain("detected → <strong>validated</strong>"); // timeline from lifecycle history
    expect(html).toContain("confirmed by data");
  });

  it("404 for an unknown opportunity id", async () => {
    expect((await get(`/opportunities/${randomUUID()}`)).status).toBe(404);
  });

  it("a missing evidence reference fails loudly (I4)", async () => {
    const { getOpportunityDetail } = await import("@aigos/growth");
    const me = await provisionOnSignIn(h.app, "halim@test.dev");
    const ws = me.workspaces[0]!.id;
    // delete the evidence row to simulate a dangling reference
    await h.admin.query(`DELETE FROM detector_findings WHERE evidence_id = $1`, [evidenceId]).catch(() => {});
    await h.admin.query(`DELETE FROM evidence WHERE id = $1`, [evidenceId]);
    await expect(getOpportunityDetail(h.app, ws, opportunityId)).rejects.toThrow(/missing evidence reference/i);
  });
});
