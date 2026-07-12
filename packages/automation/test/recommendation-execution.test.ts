/** STEP 7.4 — human-configured auto-acceptance via automation hooks; reuses growth lifecycle; no publishing; evidence linked. */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withWorkspace } from "@aigos/database";

import { buildDefaultActionRegistry, emitOpportunityEvent } from "../src/index.js";
import { startHarness, seedWorkspace, type Harness } from "../../database/test/harness.js";

let h: Harness;
const WS = randomUUID();
const USER = randomUUID();
let registry: ReturnType<typeof buildDefaultActionRegistry>;
let opportunityId = "";
let evidenceId = "";

async function rule(triggerType: string, action: string): Promise<void> {
  await withWorkspace(h.app, WS, (tx) =>
    tx.query(
      `INSERT INTO automation_rules (workspace_id, name, trigger, condition, action, ladder_level, created_by)
       VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, $2::jsonb, '[{"field":"confidence","op":"eq","value":"high"}]'::jsonb, $3, 'A2', $4)`,
      [`${action} on ${triggerType}`, JSON.stringify({ type: triggerType }), action, USER],
    ),
  );
}

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  await h.admin.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@t.dev', 'magic_link')`, [USER]);
  registry = buildDefaultActionRegistry(h.app);
  evidenceId = randomUUID();
  await withWorkspace(h.app, WS, async (tx) => {
    await tx.query(`INSERT INTO evidence (id, workspace_id, generated_by, data) VALUES ($1, NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'x@1', '{}'::jsonb)`, [evidenceId]);
    const o = await tx.query(`INSERT INTO opportunities (workspace_id, entity, category, detectors, severity, confidence, impact, difficulty, effort, roi, priority_score, score_trace, evidence_ids, occurred_on, dedupe_hash) VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'e', 'seo', '[]'::jsonb, 'medium', 'high', 'medium', 'low', 'low', '{}'::jsonb, 0.8, '{}'::jsonb, $1::jsonb, '2026-07-12', $2) RETURNING id`, [JSON.stringify([evidenceId]), randomUUID()]);
    opportunityId = o.rows[0].id;
  });
  await rule("opportunity.detected", "opportunity.validate");
  await rule("opportunity.validated", "opportunity.accept");
}, 120_000);

afterAll(async () => { await h.stop(); });

const status = async (): Promise<string> => (await h.admin.query(`SELECT status FROM opportunities WHERE id = $1`, [opportunityId])).rows[0].status;

describe("automatic recommendation acceptance (human-configured, no publishing)", () => {
  it("validates on the detected event via the growth lifecycle (reused)", async () => {
    const r = await emitOpportunityEvent(h.app, registry, WS, opportunityId, "opportunity.detected");
    expect(r.ran).toBe(1);
    expect(await status()).toBe("validated");
    const ex = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT result FROM automation_executions WHERE trigger_ref = $1`, [`${opportunityId}:opportunity.detected`]));
    expect(ex.rows[0].result.evidenceIds).toEqual([evidenceId]); // evidence linkage (I4)
  });

  it("accepts on the validated event; opportunity.transition audited", async () => {
    const r = await emitOpportunityEvent(h.app, registry, WS, opportunityId, "opportunity.validated");
    expect(r.ran).toBe(1);
    expect(await status()).toBe("accepted");
    const audit = await h.admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE event = 'opportunity.transition' AND details->>'opportunityId' = $1`, [opportunityId]);
    expect(audit.rows[0].n).toBe(2); // validated + accepted
  });

  it("no automation action may publish (registry structurally refuses it)", async () => {
    expect(registry.has("opportunity.validate")).toBe(true);
    expect(registry.has("opportunity.accept")).toBe(true);
    expect(registry.has("draft.publish")).toBe(false); // no such action exists
  });

  it("re-emitting the same event is idempotent", async () => {
    const before = await status();
    const r = await emitOpportunityEvent(h.app, registry, WS, opportunityId, "opportunity.validated");
    expect(r.ran).toBe(0);
    expect(await status()).toBe(before);
  });
});
