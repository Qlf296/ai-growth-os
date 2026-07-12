/**
 * Phase 1.2 — full auth flow over HTTP against real Postgres:
 * request-link → email via Delivery → confirm (session cookies) →
 * refresh (rotation) → logout. CSRF header mandatory on every POST;
 * errors generic (no oracle).
 */
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Delivery, NotificationTypeRegistry, type NotificationIntent } from "@aigos/delivery";
import { MagicLinkService, SessionService } from "@aigos/identity";

import { createApiServer } from "../src/server.js";
import { startHarness, type Harness } from "../../../packages/database/test/harness.js";

let h: Harness;
let server: Server;
let base: string;
const outbox: NotificationIntent[] = [];
const UA = "node"; // fetch sends "node" UA → family "node-other"

beforeAll(async () => {
  h = await startHarness();
  const registry = new NotificationTypeRegistry();
  registry.register({ type: "security_transactional", channel: "email", dailyBudget: 0, cooldownSeconds: 0, budgetExempt: true });
  const delivery = new Delivery({
    registry,
    channels: [{ channel: "email", send: async (m) => void outbox.push(m) }],
    ledger: async () => {},
    clock: () => new Date(),
  });
  server = createApiServer({
    pool: h.app,
    magic: new MagicLinkService(h.app, delivery, () => new Date(), { baseUrl: "https://app.test" }),
    sessions: new SessionService(h.app, () => new Date()),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "string" || !addr) throw new Error("no addr");
  base = `http://127.0.0.1:${addr.port}`;
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await h.stop();
});

const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf": "1", "user-agent": UA, ...headers },
    body: body === undefined ? null : JSON.stringify(body),
  });

const getCookie = (res: Response, name: string): string => {
  const all = res.headers.getSetCookie();
  const hit = all.find((c) => c.startsWith(`${name}=`));
  return hit ? hit.split(";")[0]!.split("=")[1]! : "";
};

describe("CSRF belt-and-suspenders (S6 §2)", () => {
  it("every state-changing route refuses without X-CSRF: 1", async () => {
    for (const path of ["/auth/request-link", "/auth/confirm", "/auth/refresh", "/auth/logout"]) {
      const res = await fetch(`${base}${path}`, { method: "POST", headers: { "user-agent": UA } });
      expect(res.status, path).toBe(403);
      expect(await res.json()).toEqual({ error: "csrf" });
    }
  });
});

describe("full flow", () => {
  let sid = "";
  let refresh = "";

  it("request-link: always 204, email leaves via Delivery with the token", async () => {
    const res = await post("/auth/request-link", { email: "Halim@Test.dev" });
    expect(res.status).toBe(204);
    expect(outbox).toHaveLength(1);
    // unknown/invalid email shape: identical 204, no send
    const noop = await post("/auth/request-link", { email: "not-an-email" });
    expect(noop.status).toBe(204);
    expect(outbox).toHaveLength(1);
  });

  it("confirm: provisions user+workspace, sets sid + refresh cookies", async () => {
    const token = /token=([a-f0-9]{64})/.exec(outbox[0]!.body)![1]!;
    const res = await post("/auth/confirm", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; workspaces: { name: string; role: string }[] };
    expect(body.workspaces[0]).toMatchObject({ name: "halim's workspace", role: "owner" });
    sid = getCookie(res, "sid");
    refresh = getCookie(res, "refresh");
    expect(sid).toMatch(/^[0-9a-f-]{36}$/);
    expect(refresh).toMatch(/^[a-f0-9]{64}$/);
    const flags = res.headers.getSetCookie()[0]!;
    expect(flags).toContain("HttpOnly");
    expect(flags).toContain("SameSite=Lax");
    // replaying the same token: generic 401 (single-use)
    const replay = await post("/auth/confirm", { token });
    expect(replay.status).toBe(401);
    expect(await replay.json()).toEqual({ error: "invalid_or_expired" });
  });

  it("refresh: rotates both cookies; old refresh token then dies generically", async () => {
    const res = await post("/auth/refresh", undefined, { cookie: `refresh=${refresh}` });
    expect(res.status).toBe(200);
    const newSid = getCookie(res, "sid");
    const newRefresh = getCookie(res, "refresh");
    expect(newSid).not.toBe(sid);
    expect(newRefresh).not.toBe(refresh);
    // reuse of the retired token → 401 and family revoked (ADR-017)
    const reuse = await post("/auth/refresh", undefined, { cookie: `refresh=${refresh}` });
    expect(reuse.status).toBe(401);
    sid = newSid;
    refresh = newRefresh;
  });

  it("logout: revokes and clears cookies", async () => {
    // family was revoked by the reuse test above — sign in again for a clean session
    await post("/auth/request-link", { email: "halim@test.dev" });
    const token = /token=([a-f0-9]{64})/.exec(outbox.at(-1)!.body)![1]!;
    const confirmed = await post("/auth/confirm", { token });
    const liveSid = getCookie(confirmed, "sid");
    const res = await post("/auth/logout", undefined, { cookie: `sid=${liveSid}` });
    expect(res.status).toBe(204);
    const cleared = res.headers.getSetCookie().find((c) => c.startsWith("sid="))!;
    expect(cleared).toContain("Max-Age=0");
    const revoked = await h.admin.query(
      "SELECT count(*)::int AS n FROM sessions WHERE id = $1 AND revoked_at IS NOT NULL",
      [liveSid],
    );
    expect(revoked.rows[0].n).toBe(1);
  });

  it("audit trail: signin.success recorded", async () => {
    const audit = await h.admin.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE event = 'signin.success'",
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(2);
  });
});
