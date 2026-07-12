/** Phase 1.1 — first-login provisioning (S6 §3): plans seeded, workspace+owner membership, idempotent. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { provisionOnSignIn, isMember } from "../src/provisioning.js";
import { startHarness, type Harness } from "./harness.js";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe("plans seed (migration 0004)", () => {
  it("free has S3 §2 limits; growth exists with empty limits (founder to ratify)", async () => {
    const r = await h.admin.query("SELECT id, limits FROM plans ORDER BY id");
    expect(r.rows).toEqual([
      { id: "free", limits: { daily_actions: 5, connections: 1, tier4_calls_month: 0, poll_freq: "daily" } },
      { id: "growth", limits: {} },
    ]);
  });
});

describe("provisionOnSignIn", () => {
  it("first sign-in creates user + workspace (plan free) + owner membership + audit event", async () => {
    const identity = await provisionOnSignIn(h.app, "halim@test.dev");
    expect(identity.workspaces).toHaveLength(1);
    expect(identity.workspaces[0]).toMatchObject({ name: "halim's workspace", role: "owner" });
    const ws = await h.admin.query("SELECT plan_id FROM workspaces WHERE id = $1", [identity.workspaces[0]!.id]);
    expect(ws.rows[0].plan_id).toBe("free");
    const audit = await h.admin.query("SELECT count(*)::int AS n FROM audit_log WHERE event = 'workspace.created'");
    expect(audit.rows[0].n).toBe(1);
  });

  it("is idempotent: second sign-in returns the same user and workspace, creates nothing", async () => {
    const first = await provisionOnSignIn(h.app, "halim@test.dev");
    const second = await provisionOnSignIn(h.app, "halim@test.dev");
    expect(second.userId).toBe(first.userId);
    expect(second.workspaces).toEqual(first.workspaces);
    const count = await h.admin.query("SELECT count(*)::int AS n FROM workspaces");
    expect(count.rows[0].n).toBe(1);
  });

  it("two users never share a workspace", async () => {
    const other = await provisionOnSignIn(h.app, "other@test.dev");
    const mine = await provisionOnSignIn(h.app, "halim@test.dev");
    expect(other.workspaces[0]!.id).not.toBe(mine.workspaces[0]!.id);
  });
});

describe("isMember (workspace context check — feeds RLS scope, S6 §2)", () => {
  it("true for the owner, false for anyone else", async () => {
    const me = await provisionOnSignIn(h.app, "halim@test.dev");
    const other = await provisionOnSignIn(h.app, "other@test.dev");
    expect(await isMember(h.app, me.userId, me.workspaces[0]!.id)).toBe(true);
    expect(await isMember(h.app, other.userId, me.workspaces[0]!.id)).toBe(false);
  });
});
