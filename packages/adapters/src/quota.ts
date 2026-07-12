/**
 * Quota citizenship (ADR-021 §2): shared per-provider token bucket, two
 * layers — app-global quota and per-workspace fairness share. An adapter
 * cannot starve the fleet. Redis-backed in production (fixed-window INCR),
 * in-memory for dev/tests — same contract.
 */
import { AdapterError } from "./types.js";

export interface RateCounter {
  /** Increment and return the count for this key within the current window. */
  hit(key: string, windowSeconds: number): Promise<number>;
}

export class InMemoryRateCounter implements RateCounter {
  private readonly counts = new Map<string, { windowStart: number; count: number }>();
  constructor(private readonly clock: () => Date = () => new Date()) {}

  hit(key: string, windowSeconds: number): Promise<number> {
    const now = this.clock().getTime();
    const windowStart = Math.floor(now / (windowSeconds * 1000));
    const entry = this.counts.get(key);
    if (!entry || entry.windowStart !== windowStart) {
      this.counts.set(key, { windowStart, count: 1 });
      return Promise.resolve(1);
    }
    entry.count += 1;
    return Promise.resolve(entry.count);
  }
}

/** Structural Redis view — no ioredis dependency (same pattern as RedisCache). */
export interface RedisCounterLike {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export class RedisRateCounter implements RateCounter {
  constructor(
    private readonly redis: RedisCounterLike,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async hit(key: string, windowSeconds: number): Promise<number> {
    const bucket = Math.floor(this.clock().getTime() / (windowSeconds * 1000));
    const windowKey = `${key}:${bucket}`;
    const count = await this.redis.incr(windowKey);
    if (count === 1) await this.redis.expire(windowKey, windowSeconds * 2);
    return count;
  }
}

export interface QuotaLimits {
  readonly globalPerMinute: number;
  readonly perWorkspacePerMinute: number;
}

export class QuotaGuard {
  constructor(
    private readonly counter: RateCounter,
    private readonly clock: () => Date,
    private readonly limits: QuotaLimits,
  ) {}

  /** Throws AdapterError('quota') — the queue's bounded retry/backoff handles the rest. */
  async acquire(provider: string, workspaceId: string): Promise<void> {
    const global = await this.counter.hit(`quota:${provider}:global`, 60);
    if (global > this.limits.globalPerMinute) {
      throw new AdapterError("quota", `global ${provider} quota exhausted (${this.limits.globalPerMinute}/min)`);
    }
    const ws = await this.counter.hit(`quota:${provider}:ws:${workspaceId}`, 60);
    if (ws > this.limits.perWorkspacePerMinute) {
      throw new AdapterError("quota", `workspace fairness share exhausted for ${provider} (${this.limits.perWorkspacePerMinute}/min)`);
    }
  }
}
