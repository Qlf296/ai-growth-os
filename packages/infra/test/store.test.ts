/**
 * Cache (nothing durable in Redis — S2 §6) and RawStore (raw-first,
 * immutable — S2 §3). Contract-tested on the local drivers.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { InMemoryCache } from "../src/cache.js";
import { FsRawStore, rawKey } from "../src/raw-store.js";

describe("cache contract", () => {
  it("set/get/delete round-trip with TTL expiry", async () => {
    const c = new InMemoryCache(() => now);
    let now = 1000;
    await c.set("k", "v", 60);
    expect(await c.get("k")).toBe("v");
    now += 61_000;
    expect(await c.get("k")).toBeNull(); // expired — cache is a cache, not a store
    await c.set("k2", "v2", 60);
    await c.del("k2");
    expect(await c.get("k2")).toBeNull();
  });
});

describe("raw store contract (raw-first, immutable)", () => {
  const dir = mkdtempSync(join(tmpdir(), "aigos-raw-"));
  const store = new FsRawStore(dir);

  it("put/get round-trips bytes exactly", async () => {
    const bytes = Buffer.from(JSON.stringify({ raw: "payload", from: "gsc" }));
    const key = rawKey({ workspaceId: "ws1", provider: "gsc", capturedAt: new Date("2026-07-12T08:00:00Z"), id: "abc" });
    await store.put(key, bytes);
    expect(Buffer.compare(await store.get(key), bytes)).toBe(0);
  });

  it("keys are immutable: overwriting an existing key is refused", async () => {
    const key = rawKey({ workspaceId: "ws1", provider: "gsc", capturedAt: new Date(), id: "immutable" });
    await store.put(key, Buffer.from("original"));
    await expect(store.put(key, Buffer.from("tampered"))).rejects.toThrow(/immutable|exists/i);
    expect((await store.get(key)).toString()).toBe("original");
  });

  it("there is no delete API on the store (GDPR purge is a separate audited job)", () => {
    expect((store as unknown as Record<string, unknown>).delete).toBeUndefined();
    expect((store as unknown as Record<string, unknown>).remove).toBeUndefined();
  });

  it("rawKey layout is workspace-first (tenant-partitioned)", () => {
    const key = rawKey({ workspaceId: "ws9", provider: "ga4", capturedAt: new Date("2026-01-02T03:04:05Z"), id: "x1" });
    expect(key).toBe("ws9/ga4/2026-01-02/x1");
  });

  it("missing keys fail loudly", async () => {
    await expect(store.get("ws1/gsc/2026-07-12/nope")).rejects.toThrow(/not found/i);
  });
});
