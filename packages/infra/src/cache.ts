/** Cache port — Redis in production, memory in dev/tests. Nothing durable lives here (S2 §6). */
export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export class InMemoryCache implements Cache {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();
  constructor(private readonly clock: () => number = Date.now) {}

  get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: this.clock() + ttlSeconds * 1000 });
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }
}

/** Minimal structural view of a Redis client — no direct ioredis dependency (bullmq brings the client). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/** Thin Redis driver — TTL is mandatory: a cache entry without expiry is storage, not cache. */
export class RedisCache implements Cache {
  constructor(private readonly redis: RedisLike) {}
  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, "EX", ttlSeconds);
  }
  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
