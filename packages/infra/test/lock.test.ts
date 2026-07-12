/**
 * STEP 10.5 — distributed lock (leader election for the scheduler tick) and
 * graceful shutdown. In-memory driver is deterministic via an injected clock;
 * the Redis driver is exercised through a structural fake.
 */
import { describe, expect, it, vi } from "vitest";

import { GracefulShutdown, InMemoryLock, RedisLock, type RedisLockClient } from "../src/index.js";

describe("InMemoryLock", () => {
  const build = () => {
    let now = 0;
    let seq = 0;
    const lock = new InMemoryLock(() => now, () => `t${seq++}`);
    return { lock, advance: (ms: number) => (now += ms) };
  };

  it("grants a single holder and refuses a second (mutual exclusion)", async () => {
    const { lock } = build();
    const a = await lock.acquire("tick", 1000);
    const b = await lock.acquire("tick", 1000);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it("re-acquires after release", async () => {
    const { lock } = build();
    const a = await lock.acquire("tick", 1000);
    await lock.release(a!);
    expect(await lock.acquire("tick", 1000)).not.toBeNull();
  });

  it("re-acquires after the ttl expires (self-healing on crash)", async () => {
    const { lock, advance } = build();
    await lock.acquire("tick", 1000);
    expect(await lock.acquire("tick", 1000)).toBeNull();
    advance(1001);
    expect(await lock.acquire("tick", 1000)).not.toBeNull();
  });

  it("ignores release from a non-owner token (fencing)", async () => {
    const { lock } = build();
    const a = await lock.acquire("tick", 1000);
    await lock.release({ key: "tick", token: "someone-else" });
    expect(await lock.acquire("tick", 1000)).toBeNull(); // still held by a
    await lock.release(a!);
  });

  it("withLock runs the fn once; a competing holder gets null and does not run", async () => {
    const { lock } = build();
    const ran: string[] = [];
    const gate = lock.withLock("tick", 1000, async () => {
      const blocked = await lock.withLock("tick", 1000, async () => ran.push("second"));
      expect(blocked).toBeNull();
      ran.push("first");
      return "done";
    });
    await expect(gate).resolves.toBe("done");
    expect(ran).toEqual(["first"]);
  });
});

describe("RedisLock", () => {
  it("acquires via SET NX and releases only as owner", async () => {
    const store = new Map<string, string>();
    const client: RedisLockClient = {
      set: async (key, token) => (store.has(key) ? null : (store.set(key, token), "OK")),
      releaseIfOwner: async (key, token) => {
        if (store.get(key) === token) store.delete(key);
      },
    };
    const lock = new RedisLock(client, () => "tok");
    const a = await lock.acquire("tick", 1000);
    expect(a).not.toBeNull();
    expect(await lock.acquire("tick", 1000)).toBeNull();
    await lock.release(a!);
    expect(await lock.acquire("tick", 1000)).not.toBeNull();
  });
});

describe("GracefulShutdown", () => {
  it("runs hooks once in LIFO order and flips draining", async () => {
    const order: number[] = [];
    const gs = new GracefulShutdown();
    gs.onShutdown(async () => void order.push(1));
    gs.onShutdown(async () => void order.push(2));
    expect(gs.draining).toBe(false);
    await gs.shutdown();
    expect(gs.draining).toBe(true);
    expect(order).toEqual([2, 1]);
    await gs.shutdown(); // idempotent
    expect(order).toEqual([2, 1]);
  });

  it("continues remaining hooks even if one throws", async () => {
    const order: number[] = [];
    const gs = new GracefulShutdown();
    gs.onShutdown(async () => void order.push(1));
    gs.onShutdown(async () => {
      throw new Error("hook boom");
    });
    await gs.shutdown();
    expect(order).toEqual([1]);
  });
});
