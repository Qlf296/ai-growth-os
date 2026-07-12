/**
 * Phase 1.4 — SSR web skeleton. One process = API + SSR (S2 §1): the web
 * server serves the pages AND the existing auth API routes on one origin.
 */
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Delivery, NotificationTypeRegistry, type NotificationIntent } from "@aigos/delivery";
import { MagicLinkService, SessionService } from "@aigos/identity";
import { provisionOnSignIn } from "@aigos/database";

import { createWebServer } from "../src/server.js";
import { startHarness, type Harness } from "../../../packages/database/test/harness.js";

let h: Harness;
let server: Server;
let base: string;
let sid = "";
const outbox: NotificationIntent[] = [];

beforeAll(async () => {
  h = await startHarness();
  const sessions = new SessionService(h.app, () => new Date());
  const registry = new NotificationTypeRegistry();
  registry.register({ type: "security_transactional", channel: "email", dailyBudget: 0, cooldownSeconds: 0, budgetExempt: true });
  const delivery = new Delivery({
    registry,
    channels: [{ channel: "email", send: async (m) => void outbox.push(m) }],
    ledger: async () => {},
    clock: () => new Date(),
  });
  server = createWebServer({
    pool: h.app,
    magic: new MagicLinkService(h.app, delivery, () => new Date(), { baseUrl: "https://app.test" }),
    sessions,
    clock: () => new Date("2026-07-12T09:00:00Z"),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "string" || !addr) throw new Error("no addr");
  base = `http://127.0.0.1:${addr.port}`;

  const me = await provisionOnSignIn(h.app, "halim@test.dev");
  sid = (await sessions.issue(me.userId, "node-other", "127.0.0.1")).sessionId;
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await h.stop();
});

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { headers: { "user-agent": "node", ...headers }, redirect: "manual" });

describe("auth guard", () => {
  it("redirects every app page to /login without a session", async () => {
    for (const path of ["/", "/experiments", "/learnings", "/settings"]) {
      const res = await get(path);
      expect(res.status, path).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    }
  });

  it("an invalid sid is redirected too", async () => {
    const res = await get("/", { cookie: "sid=00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(302);
  });
});

describe("login + confirmation tap", () => {
  it("GET /login renders the email form (no session required)", async () => {
    const res = await get("/login");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('type="email"');
    expect(html).toContain("AI Growth OS");
  });

  it("GET /auth/confirm?token=… renders the tap page without consuming the token (R19)", async () => {
    await fetch(`${base}/auth/request-link`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf": "1", "user-agent": "node" },
      body: JSON.stringify({ email: "halim@test.dev" }),
    });
    const token = /token=([a-f0-9]{64})/.exec(outbox.at(-1)!.body)![1]!;
    const res = await get(`/auth/confirm?token=${token}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Confirm sign-in");
    const unconsumed = await h.admin.query(
      "SELECT count(*)::int AS n FROM magic_link_tokens WHERE consumed_at IS NULL",
    );
    expect(unconsumed.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("a signed-in user visiting /login is sent to the app", async () => {
    const res = await get("/login", { cookie: `sid=${sid}` });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });
});

describe("app pages (S5 sections)", () => {
  it("renders the four sections with shared layout, active nav and empty states", async () => {
    const pages: [string, string][] = [
      ["/", "Today"],
      ["/experiments", "Experiments"],
      ["/learnings", "Learnings"],
      ["/settings", "Settings"],
    ];
    for (const [path, title] of pages) {
      const res = await get(path, { cookie: `sid=${sid}` });
      expect(res.status, path).toBe(200);
      const html = await res.text();
      expect(html).toContain(`<h1>${title}</h1>`);
      for (const nav of ["Today", "Experiments", "Learnings", "Settings"]) expect(html).toContain(`>${nav}</a>`);
      expect(html).toContain('aria-current="page"');
      expect(html).toContain("halim@test.dev");
      expect(html).toContain('name="viewport"');
    }
  });
});

describe("Today — empty dashboard (S5 §1 anatomy, §8 truthful zero-state)", () => {
  it("renders the localized date header, workspace context and plan", async () => {
    const res = await get("/", { cookie: `sid=${sid}` });
    const html = await res.text();
    expect(html).toContain("dimanche 12 juillet"); // user locale fr (S3 §2 default)
    expect(html).toContain("halim&#39;s workspace");
    expect(html).toContain("free");
  });

  it("zero-state is honest and points to the prerequisite (ADR-015: connect GSC first)", async () => {
    const res = await get("/", { cookie: `sid=${sid}` });
    const html = await res.text();
    expect(html).toContain("No actions yet");
    expect(html).toContain("Google Search Console");
    expect(html).not.toMatch(/lorem|placeholder|coming soon/i);
  });
});

describe("one origin serves the API too (S2 §1)", () => {
  it("POST /auth/request-link works through the web server", async () => {
    const res = await fetch(`${base}/auth/request-link`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf": "1", "user-agent": "node" },
      body: JSON.stringify({ email: "halim@test.dev" }),
    });
    expect(res.status).toBe(204);
  });

  it("unknown routes are JSON 404 (API) — pages own only their explicit paths", async () => {
    const res = await get("/nope");
    expect(res.status).toBe(404);
  });
});
