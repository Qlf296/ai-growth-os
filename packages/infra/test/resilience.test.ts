/**
 * STEP 10.3 — resilience primitives: bounded retry with exponential backoff,
 * timeout, and a deterministic circuit breaker. All timing is injected so the
 * tests are deterministic (no wall-clock flakiness).
 */
import { describe, expect, it, vi } from "vitest";

import {
  CircuitBreaker,
  CircuitOpenError,
  TimeoutError,
  withRetry,
  withTimeout,
} from "../src/index.js";

describe("withRetry", () => {
  it("returns on the first success without sleeping", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => "ok");
    await expect(withRetry(fn, { attempts: 3, backoffMs: 10, sleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries up to the bound then throws the last error", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => {
      throw new Error("nope");
    });
    await expect(withRetry(fn, { attempts: 3, backoffMs: 10, sleep })).rejects.toThrow("nope");
    expect(fn).toHaveBeenCalledTimes(3); // bounded, never infinite (ADR-003)
  });

  it("uses exponential backoff capped by maxBackoffMs", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      delays.push(ms);
    };
    let n = 0;
    const fn = async (): Promise<string> => {
      if (n++ < 3) throw new Error("retry");
      return "done";
    };
    await withRetry(fn, { attempts: 5, backoffMs: 10, maxBackoffMs: 25, sleep });
    expect(delays).toEqual([10, 20, 25]); // 10, 20, 40→cap 25
  });

  it("does not retry when isRetryable returns false", async () => {
    const fn = vi.fn(async () => {
      throw new Error("fatal");
    });
    await expect(
      withRetry(fn, { attempts: 5, backoffMs: 1, sleep: async () => {}, isRetryable: () => false }),
    ).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("withTimeout", () => {
  it("resolves when the operation finishes in time", async () => {
    await expect(withTimeout(() => Promise.resolve(42), 50)).resolves.toBe(42);
  });

  it("rejects with TimeoutError when the operation is too slow", async () => {
    const slow = () => new Promise((r) => setTimeout(() => r(1), 50));
    await expect(withTimeout(slow, 10)).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe("CircuitBreaker", () => {
  const build = () => {
    let now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 2, resetMs: 1000, clock: () => now });
    return { cb, advance: (ms: number) => (now += ms) };
  };

  it("opens after the failure threshold and short-circuits", async () => {
    const { cb } = build();
    const boom = () => Promise.reject(new Error("down"));
    await expect(cb.exec(boom)).rejects.toThrow("down");
    await expect(cb.exec(boom)).rejects.toThrow("down");
    expect(cb.state).toBe("open");
    const fn = vi.fn(boom);
    await expect(cb.exec(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled(); // short-circuited, dependency protected
  });

  it("half-opens after resetMs and closes on a successful trial", async () => {
    const { cb, advance } = build();
    const boom = () => Promise.reject(new Error("down"));
    await cb.exec(boom).catch(() => {});
    await cb.exec(boom).catch(() => {});
    expect(cb.state).toBe("open");
    advance(1000);
    await expect(cb.exec(() => Promise.resolve("ok"))).resolves.toBe("ok"); // half-open trial
    expect(cb.state).toBe("closed");
  });

  it("re-opens if the half-open trial fails", async () => {
    const { cb, advance } = build();
    const boom = () => Promise.reject(new Error("down"));
    await cb.exec(boom).catch(() => {});
    await cb.exec(boom).catch(() => {});
    advance(1000);
    await cb.exec(boom).catch(() => {});
    expect(cb.state).toBe("open");
  });
});
