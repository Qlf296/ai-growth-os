/** API skeleton: health endpoint + JSON 404. No framework until one is needed (P2). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  it("GET /health → 200 {status:'ok'}", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("unknown route → 404 JSON, no stack traces", async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
