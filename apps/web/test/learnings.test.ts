/** STEP 8.4 — Learnings page: measured outcomes, grades, track record; every claim carries evidence. */
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Delivery, NotificationTypeRegistry } from "@aigos/delivery";
import { MagicLinkService, SessionService } from "@aigos/identity";
import { provisionOnSignIn } from "@aigos/database";
import { recordOutcome } from "@aigos/analytics";

import { createWebServer } from "../src/server.js";
import { startHarness, type Harness } from "../../../packages/database/test/harness.js";

let h: Harness; let server: Server; let base: string; let sidEmpty = ""; let sidData = ""; let evidenceRef = "";

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
  const data = await provisionOnSignIn(h.app, "data@test.dev");
  const empty = await provisionOnSignIn(h.app, "empty@test.dev");
  sidData = (await sessions.issue(data.userId, "node-other", "127.0.0.1")).sessionId;
  sidEmpty = (await sessions.issue(empty.userId, "node-other", "127.0.0.1")).sessionId;
  const r = await recordOutcome(h.app, data.workspaces[0]!.id, { subjectType: "opportunity", subjectId: randomUUID(), metric: "ctr", baselineValue: 0.02, observedValue: 0.03, windowDays: 28, targetImprovement: 0.1 });
  evidenceRef = r.evidenceReferenceId;
}, 120_000);

afterAll(async () => { await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))); await h.stop(); });

const get = (sid: string) => fetch(`${base}/learnings`, { headers: { "user-agent": "node", cookie: `sid=${sid}` }, redirect: "manual" });

describe("learnings page", () => {
  it("shows the track record, verdict, grade and cites the evidenceReferenceId", async () => {
    const html = await (await get(sidData)).text();
    expect(html).toContain("Track record");
    expect(html).toContain("1 met");
    expect(html).toContain("ctr");
    expect(html).toContain("B"); // grade
    expect(html).toContain(evidenceRef); // I4
  });
  it("honest empty state when nothing measured", async () => {
    const html = await (await get(sidEmpty)).text();
    expect(html).toContain("Nothing learned yet");
    expect(html).not.toContain("Track record");
  });
});
