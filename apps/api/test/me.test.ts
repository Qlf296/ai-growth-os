/** Phase 1.3 — /me + /me/workspace: session-gated, membership-gated, RLS-scoped. */
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { provisionOnSignIn } from "@aigos/database";
import { SessionService } from "@aigos/identity";
import { MagicLinkService } from "@aigos/identity";
import { Delivery, NotificationTypeRegistry } from "@aigos/delivery";

import { createApiServer } from "../src/server.js";
import { startHarness, type Harness } from "../../../packages/database/test/harness.js";

let h: Harness;
let server: Server;
let base: string;
let sidMe = "";
let sidOther = "";
let myWorkspaceId = "";

beforeAll(async () => {
  h = await startHarness();
  const sessions = new SessionService(h.app, () => new Date());
  const registry = new NotificationTypeRegistry();
  registry.register({ type: "security_transactional", channel: "email", dailyBudget: 0, cooldownSeconds: 0, budgetExempt: true });
  const delivery = new Delivery({ registry, channels: [{ channel: "email", send: async () => {} }], ledger: async () => {}, clock: () => new Date() });
  server = createApiServer({
    pool: h.app,
    magic: new MagicLinkService(h.app, delivery, () => new Date(), { baseUrl: "https://x" }),
    sessions,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "string" || !addr) throw new Error("no addr");
  base = `http://127.0.0.1:${addr.port}`;

  const me = await provisionOnSignIn(h.app, "halim@test.dev");
  const other = await provisionOnSignIn(h.app, "other@test.dev");
  myWorkspaceId = me.workspaces[0]!.id;
  sidMe = (await sessions.issue(me.userId, "node-other", "127.0.0.1")).sessionId;
  sidOther = (await sessions.issue(other.userId, "node-other", "127.0.0.1")).sessionId;
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await h.stop();
});

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { headers: { "user-agent": "node", ...headers } });

describe("GET /me", () => {
  it("401 without a session; user + own workspaces with one", async () => {
    expect((await get("/me")).status).toBe(401);
    const res = await get("/me", { cookie: `sid=${sidMe}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string }; workspaces: unknown[] };
    expect(body.user.email).toBe("halim@test.dev");
    expect(body.workspaces).toHaveLength(1);
  });
});

describe("GET /me/workspace (X-Workspace-Id → isMember → RLS scope)", () => {
  it("returns workspace + plan limits for a member", async () => {
    const res = await get("/me/workspace", { cookie: `sid=${sidMe}`, "x-workspace-id": myWorkspaceId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workspace: { id: string; plan_id: string; limits: { daily_actions: number } } };
    expect(body.workspace.id).toBe(myWorkspaceId);
    expect(body.workspace.plan_id).toBe("free");
    expect(body.workspace.limits.daily_actions).toBe(5);
  });

  it("403 for a non-member (another user's workspace id)", async () => {
    const res = await get("/me/workspace", { cookie: `sid=${sidOther}`, "x-workspace-id": myWorkspaceId });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_a_member" });
  });

  it("403 for a missing/malformed header, 401 without session", async () => {
    expect((await get("/me/workspace", { cookie: `sid=${sidMe}` })).status).toBe(403);
    expect((await get("/me/workspace", { cookie: `sid=${sidMe}`, "x-workspace-id": "junk" })).status).toBe(403);
    expect((await get("/me/workspace", { "x-workspace-id": randomUUID() })).status).toBe(401);
  });

  it("membership gate + RLS double-lock: even a forged unknown uuid yields 403, never data", async () => {
    const res = await get("/me/workspace", { cookie: `sid=${sidMe}`, "x-workspace-id": randomUUID() });
    expect(res.status).toBe(403);
  });
});
