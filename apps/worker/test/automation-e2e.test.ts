/** STEP 7.3 — automation via scheduler/queue: idempotent execution, retry-safe, DB-persisted history. */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ActionRegistry, type ActionHandler } from "@aigos/automation";
import { withWorkspace } from "@aigos/database";
import { InMemoryJobQueue, MetricsRegistry } from "@aigos/infra";

import { createAutomationHandler } from "../src/automation.js";
import type { SchedulerPayload } from "../src/scheduler.js";
import { startHarness, seedWorkspace, type Harness } from "../../../packages/database/test/harness.js";

let h: Harness;
const WS = randomUUID();
const USER = randomUUID();
let registry: ActionRegistry;
let ran = 0;

async function seedRule(action: string, ladder = "A2"): Promise<string> {
  const r = await withWorkspace(h.app, WS, (tx) =>
    tx.query(
      `INSERT INTO automation_rules (workspace_id, name, trigger, condition, action, ladder_level, created_by)
       VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, 'auto-validate', '{"type":"opportunity.detected"}'::jsonb, '[{"field":"confidence","op":"eq","value":"high"}]'::jsonb, $1, $2, $3) RETURNING id`,
      [action, ladder, USER],
    ),
  );
  return r.rows[0].id;
}

const validateAction: ActionHandler = { name: "opportunity.validate", publishes: false, async run() { ran++; return { ok: true, detail: { validated: true } }; } };

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  await h.admin.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@t.dev', 'magic_link')`, [USER]);
  registry = new ActionRegistry();
  registry.register(validateAction);
  await seedRule("opportunity.validate");
}, 120_000);

afterAll(async () => { await h.stop(); });

const enqueueRun = async (triggerRef: string, fact: Record<string, unknown>, attempts = 1) => {
  const q = new InMemoryJobQueue<SchedulerPayload>({ attempts, backoffMs: 0 });
  q.process(createAutomationHandler({ pool: h.app, registry, metrics: new MetricsRegistry() }));
  await q.enqueue({ jobId: `a-${triggerRef}`, payload: { family: "automation.run", workspaceId: null, scheduledFor: "2026-07-12T00:00:00Z", params: { workspaceId: WS, triggerType: "opportunity.detected", triggerRef, fact } } });
  await q.drain();
  return q;
};

describe("automation execution via the queue", () => {
  it("runs a matching rule and persists an execution record", async () => {
    await enqueueRun("opp-1", { confidence: "high" });
    expect(ran).toBe(1);
    const ex = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT status, result FROM automation_executions WHERE trigger_ref = 'opp-1'`));
    expect(ex.rowCount).toBe(1);
    expect(ex.rows[0].status).toBe("ok");
    expect(ex.rows[0].result).toMatchObject({ validated: true });
  });

  it("is idempotent: re-processing the same trigger_ref runs the action zero more times", async () => {
    const before = ran;
    await enqueueRun("opp-1", { confidence: "high" }); // same ref
    expect(ran).toBe(before);
    const ex = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT count(*)::int AS n FROM automation_executions WHERE trigger_ref = 'opp-1'`));
    expect(ex.rows[0].n).toBe(1);
  });

  it("skips when the condition is false (records skipped, action not run)", async () => {
    const before = ran;
    await enqueueRun("opp-low", { confidence: "low" });
    expect(ran).toBe(before);
    const ex = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT status FROM automation_executions WHERE trigger_ref = 'opp-low'`));
    expect(ex.rows[0].status).toBe("skipped");
  });

  it("queue retries do not double-execute (idempotent under retry)", async () => {
    const before = ran;
    await enqueueRun("opp-2", { confidence: "high" }, 3);
    expect(ran).toBe(before + 1);
  });
});
