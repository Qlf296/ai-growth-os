/**
 * Phase 6.1 — the real Today dashboard renders from repositories only
 * (buildDigest): daily summary, ranked active opportunities, priority,
 * recommendation titles and draft status. Honest zero-state when empty.
 */
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Delivery, NotificationTypeRegistry } from "@aigos/delivery";
import { MagicLinkService, SessionService } from "@aigos/identity";
import { provisionOnSignIn, withWorkspace } from "@aigos/database";

import { createWebServer } from "../src/server.js";
import { startHarness, type Harness } from "../../../packages/database/test/harness.js";

let h: Harness;
let server: Server;
let base: string;
let sidWithData = "";
let sidEmpty = "";
const DAY = "2026-07-12";

async function seedActiveOpportunity(workspaceId: string): Promise<void> {
  const evidenceId = randomUUID();
  await withWorkspace(h.app, workspaceId, async (tx) => {
    await tx.query(`INSERT INTO evidence (id, workspace_id, generated_by, data) VALUES ($1, NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'seo.ctr_gap@1', '{"metric":"ctr","value":0.01}'::jsonb)`, [evidenceId]);
    const o = await tx.query(
      `INSERT INTO opportunities (workspace_id, entity, category, detectors, severity, confidence, impact, difficulty, effort, roi, priority_score, score_trace, evidence_ids, occurred_on, dedupe_hash)
       VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'https://forgcv.com/cv-sans-experience', 'seo', '["seo.ctr_gap"]'::jsonb, 'medium', 'high', 'medium', 'low', 'low', '{"monetized":false}'::jsonb, 0.72, '{}'::jsonb, $1::jsonb, $2, $3) RETURNING id`,
      [JSON.stringify([evidenceId]), DAY, randomUUID()],
    );
    await tx.query(
      `INSERT INTO recommendations (workspace_id, opportunity_id, title, summary, business_reason, technical_reason, expected_impact, evidence_ids, affected_entities, prerequisites, steps, rollback)
       VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, 'Rewrite title/meta to close the CTR gap', 'CTR below expectation', 'biz', 'tech', 'clicks', $2::jsonb, '["https://forgcv.com/cv-sans-experience"]'::jsonb, '[]'::jsonb, '["a"]'::jsonb, 'revert')`,
      [o.rows[0].id, JSON.stringify([evidenceId])],
    );
  });
}

beforeAll(async () => {
  h = await startHarness();
  const sessions = new SessionService(h.app, () => new Date());
  const registry = new NotificationTypeRegistry();
  registry.register({ type: "security_transactional", channel: "email", dailyBudget: 0, cooldownSeconds: 0, budgetExempt: true });
  const delivery = new Delivery({ registry, channels: [{ channel: "email", send: async () => {} }], ledger: async () => {}, clock: () => new Date() });
  server = createWebServer({
    pool: h.app,
    magic: new MagicLinkService(h.app, delivery, () => new Date(), { baseUrl: "https://x" }),
    sessions,
    clock: () => new Date("2026-07-12T09:00:00Z"),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr === "string" || !addr) throw new Error("no addr");
  base = `http://127.0.0.1:${addr.port}`;

  const withData = await provisionOnSignIn(h.app, "data@test.dev");
  const empty = await provisionOnSignIn(h.app, "empty@test.dev");
  await seedActiveOpportunity(withData.workspaces[0]!.id);
  sidWithData = (await sessions.issue(withData.userId, "node-other", "127.0.0.1")).sessionId;
  sidEmpty = (await sessions.issue(empty.userId, "node-other", "127.0.0.1")).sessionId;
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await h.stop();
});

const get = (sid: string) => fetch(`${base}/`, { headers: { "user-agent": "node", cookie: `sid=${sid}` }, redirect: "manual" });

describe("Today dashboard (real data from repositories)", () => {
  it("renders the daily summary and the ranked active opportunity with its recommendation", async () => {
    const html = await (await get(sidWithData)).text();
    expect(html).toContain("Daily summary");
    expect(html).toContain("cv-sans-experience");                       // opportunity entity
    expect(html).toContain("Rewrite title/meta to close the CTR gap");  // recommendation title
    expect(html).toContain("medium");                                    // impact/severity tier
    expect(html).toContain("0.72");                                      // priority score (evidence-backed opportunity)
    expect(html).not.toMatch(/lorem|placeholder|coming soon/i);
  });

  it("keeps the honest zero-state for a workspace with no opportunities", async () => {
    const html = await (await get(sidEmpty)).text();
    expect(html).toContain("No actions yet");
    expect(html).toContain("Google Search Console");
    expect(html).not.toContain("Daily summary");
  });
});
