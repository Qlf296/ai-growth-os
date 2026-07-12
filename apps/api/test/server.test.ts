/** API skeleton: health endpoint + JSON 404. No framework until one is needed (P2). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HealthRegistry } from "@aigos/infra";

import { createApiServer } from "../src/server.js";

const server = createApiServer();
let base: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "string" || !addr) throw new Error("no address");
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))));

describe("api skeleton", () => {
  it("GET /health → 200 {status:'ok'} when all checks pass", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", checks: {} });
  });

  it("GET /health → 503 degraded when a registered check fails", async () => {
    const health = new HealthRegistry();
    health.register("db", async () => false);
    const bad = createApiServer({ health });
    await new Promise<void>((resolve) => bad.listen(0, "127.0.0.1", resolve));
    const addr = bad.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded", checks: { db: false } });
    await new Promise<void>((resolve, reject) => bad.close((e) => (e ? reject(e) : resolve())));
  });

  it("unknown route → 404 JSON, no stack traces", async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
