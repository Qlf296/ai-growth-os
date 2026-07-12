/**
 * Resilience primitives (STEP 10.3): bounded retry with exponential backoff,
 * timeout, and a circuit breaker. Production wiring (Redis, Supabase pooler,
 * providers) composes these; timing is injected so behaviour is deterministic
 * and testable, and every policy is *bounded* — never infinite (ADR-003).
 */

export interface RetryOptions {
  /** Total attempts (>=1). Bounded by construction. */
  readonly attempts: number;
  /** Base backoff; doubles each retry. */
  readonly backoffMs: number;
  /** Upper bound for a single backoff delay. */
  readonly maxBackoffMs?: number;
  /** Injected sleeper (default real timer). */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Retry only when this returns true (default: retry any error). */
  readonly isRetryable?: (error: unknown) => boolean;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const attempts = Math.max(1, opts.attempts);
  const sleep = opts.sleep ?? realSleep;
  const cap = opts.maxBackoffMs ?? Number.POSITIVE_INFINITY;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = opts.isRetryable ? opts.isRetryable(error) : true;
      if (!retryable || attempt === attempts - 1) break;
      await sleep(Math.min(opts.backoffMs * 2 ** attempt, cap));
    }
  }
  throw lastError;
}

export class TimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`operation timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/** Rejects with TimeoutError if fn does not settle within ms. Clears the timer on settle. */
export function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    fn().then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export type CircuitState = "closed" | "open" | "half_open";

export class CircuitOpenError extends Error {
  constructor() {
    super("circuit is open — short-circuiting to protect the dependency");
    this.name = "CircuitOpenError";
  }
}

export interface CircuitBreakerOptions {
  /** Consecutive failures that trip the breaker. */
  readonly failureThreshold: number;
  /** Cool-down before a half-open trial is allowed. */
  readonly resetMs: number;
  /** Injected clock (default Date.now) for deterministic tests. */
  readonly clock?: () => number;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private _state: CircuitState = "closed";
  private readonly clock: () => number;

  constructor(private readonly opts: CircuitBreakerOptions) {
    this.clock = opts.clock ?? Date.now;
  }

  get state(): CircuitState {
    if (this._state === "open" && this.clock() - this.openedAt >= this.opts.resetMs) return "half_open";
    return this._state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    const observed = this.state;
    if (observed === "open") throw new CircuitOpenError();
    try {
      const result = await fn();
      this.failures = 0;
      this._state = "closed";
      return result;
    } catch (error) {
      this.failures += 1;
      // Trip on threshold, or immediately again if this was a half-open trial.
      if (this.failures >= this.opts.failureThreshold || observed === "half_open") {
        this._state = "open";
        this.openedAt = this.clock();
      }
      throw error;
    }
  }
}
