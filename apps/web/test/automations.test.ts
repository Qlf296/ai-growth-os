/** STEP 7.6 — automation dashboard (rules + execution history/timeline) and real experiments page. */
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Delivery, NotificationTypeRegistry } from "@aigos/delivery";
import { MagicLinkService, SessionService } from "@aigos/identity";
import { provisionOnSignIn, withWorkspace } from "@aigos/database";
import { createExperiment, recordMetric, evaluateExperiment } from "@aigos/automation";

import { createWebServer } from "../src/server.js";
import { startHarness, type Harness } from "../../../packages/database/test/harness.js";

let h: Harness; let server: Server; let base: string; let sid = "";

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
  // an automation rule + an execution
  await withWorkspace(h.app, ws, async (tx) => {
    const r = await tx.query(`INSERT INTO automation_rules (workspace_id, name, trigger, condition, action, ladder_level, created_by) VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'Auto-validate high confidence', '{"type":"opportunity.detected"}'::jsonb, '[]'::jsonb, 'opportunity.validate', 'A2', $1) RETURNING id`, [me.userId]);
    await tx.query(`INSERT INTO automation_executions (workspace_id, rule_id, trigger_ref, status, result) VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, 'opp-123', 'ok', '{}'::jsonb)`, [r.rows[0].id]);
  });
  // an evaluated experiment
  const e = await createExperiment(h.app, ws, { hypothesis: "Title rewrite lifts CTR", expectedImpact: "+8%", confidence: "high", metric: "ctr", variants: [{ label: "control" }, { label: "treatment" }] });
  const t = e.variants.find((v) => v.label === "treatment")!;
  await recordMetric(h.app, ws, e.id, t.id, "ctr", 0.07);
  await evaluateExperiment(h.app, ws, e.id);
}, 120_000);

afterAll(async () => { await new Promise<void>((res, rej) => server.close((er) => (er ? rej(er) : res()))); await h.stop(); });

const get = (path: string) => fetch(`${base}${path}`, { headers: { "user-agent": "node", cookie: `sid=${sid}` }, redirect: "manual" });

describe("automation dashboard", () => {
  it("lists rules and the execution timeline", async () => {
    const html = await (await get("/automations")).text();
    expect(html).toContain("Auto-validate high confidence");
    expect(html).toContain("opportunity.detected → opportunity.validate");
    expect(html).toContain("A2");
    expect(html).toContain("Execution history");
    expect(html).toContain("opp-123");
  });
});

describe("experiments page (real data)", () => {
  it("shows the completed experiment with hypothesis, metric and winner", async () => {
    const html = await (await get("/experiments")).text();
    expect(html).toContain("Title rewrite lifts CTR");
    expect(html).toContain("Completed");
    expect(html).toContain("winner treatment");
    expect(html).toContain("metric ctr");
  });
});
