/**
 * Distributed lock (STEP 10.5) — leader election so exactly one worker replica
 * runs the scheduler tick, and a graceful-shutdown coordinator for safe
 * restarts. In-memory driver (dev/tests) is deterministic via injected clock +
 * token factory; the Redis driver is a thin SET-NX wrapper with owner-fenced
 * release (structural client, no direct ioredis dependency).
 */
import { randomUUID } from "node:crypto";

export interface LockHandle {
  readonly key: string;
  readonly token: string;
}

export interface DistributedLock {
  acquire(key: string, ttlMs: number): Promise<LockHandle | null>;
  release(handle: LockHandle): Promise<void>;
  /** Run fn iff the lock is acquired; returns null (without running) if it isn't. */
  withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null>;
}

abstract class BaseLock implements DistributedLock {
  abstract acquire(key: string, ttlMs: number): Promise<LockHandle | null>;
  abstract release(handle: LockHandle): Promise<void>;

  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    const handle = await this.acquire(key, ttlMs);
    if (!handle) return null;
    try {
      return await fn();
    } finally {
      await this.release(handle);
    }
  }
}

export class InMemoryLock extends BaseLock {
  private readonly held = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly clock: () => number = Date.now,
    private readonly mkToken: () => string = randomUUID,
  ) {
    super();
  }

  acquire(key: string, ttlMs: number): Promise<LockHandle | null> {
    const current = this.held.get(key);
    if (current && current.expiresAt > this.clock()) return Promise.resolve(null);
    const token = this.mkToken();
    this.held.set(key, { token, expiresAt: this.clock() + ttlMs });
    return Promise.resolve({ key, token });
  }

  release(handle: LockHandle): Promise<void> {
    const current = this.held.get(handle.key);
    if (current && current.token === handle.token) this.held.delete(handle.key); // fencing: only the owner releases
    return Promise.resolve();
  }
}

/** Structural view of a Redis client used for locking (SET key val NX PX ttl). */
export interface RedisLockClient {
  set(key: string, token: string, opts: { nx: true; pxMs: number }): Promise<"OK" | null>;
  releaseIfOwner(key: string, token: string): Promise<void>;
}

export class RedisLock extends BaseLock {
  constructor(
    private readonly client: RedisLockClient,
    private readonly mkToken: () => string = randomUUID,
  ) {
    super();
  }

  async acquire(key: string, ttlMs: number): Promise<LockHandle | null> {
    const token = this.mkToken();
    const res = await this.client.set(key, token, { nx: true, pxMs: ttlMs });
    return res === "OK" ? { key, token } : null;
  }

  async release(handle: LockHandle): Promise<void> {
    await this.client.releaseIfOwner(handle.key, handle.token);
  }
}

type ShutdownHook = () => Promise<void>;

/** Graceful shutdown: LIFO hook execution, idempotent, resilient to a throwing hook. */
export class GracefulShutdown {
  private readonly hooks: ShutdownHook[] = [];
  private _draining = false;

  get draining(): boolean {
    return this._draining;
  }

  onShutdown(hook: ShutdownHook): void {
    this.hooks.push(hook);
  }

  async shutdown(): Promise<void> {
    if (this._draining) return; // idempotent
    this._draining = true;
    for (let i = this.hooks.length - 1; i >= 0; i--) {
      await this.hooks[i]!().catch(() => {}); // one failing hook must not abort the rest
    }
  }
}
