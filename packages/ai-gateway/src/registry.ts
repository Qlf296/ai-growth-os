/**
 * Production provider registry (STEP 10.4). Still the ONLY model path (I6/AT-6):
 * every driver lives inside this package. The registry adds deterministic
 * provider selection, failover, per-provider resilience (circuit breaker +
 * timeout + retry, reusing @aigos/infra), cost accounting and an audit trail.
 *
 * The composed value is itself a `ModelProvider`, so it drops straight into the
 * existing `AIGateway` without widening the model surface.
 */
import { CircuitBreaker, withRetry, withTimeout } from "@aigos/infra";

import type { ModelProvider, ModelTier } from "./types.js";

export interface ProviderEntry {
  readonly provider: ModelProvider;
  readonly tiers: readonly ModelTier[];
  /** Lower is preferred; ties broken deterministically by provider name. */
  readonly priority: number;
}

export type ProviderOutcome = "ok" | "failover" | "error";

export interface ProviderAudit {
  readonly provider: string;
  readonly tier: ModelTier;
  readonly outcome: ProviderOutcome;
  readonly attemptOrder: number;
  readonly error?: string;
}

interface InvokeResult {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costEur: number;
}

export interface ProviderCost {
  readonly provider: string;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costEur: number;
}

/** Operational cost accounting per provider — distinct from the workspace budget ledger. */
export class CostAccountant {
  private readonly totalsByProvider = new Map<string, ProviderCost>();

  record(provider: string, r: { inputTokens: number; outputTokens: number; costEur: number }): void {
    const prev = this.totalsByProvider.get(provider);
    this.totalsByProvider.set(provider, {
      provider,
      calls: (prev?.calls ?? 0) + 1,
      inputTokens: (prev?.inputTokens ?? 0) + r.inputTokens,
      outputTokens: (prev?.outputTokens ?? 0) + r.outputTokens,
      costEur: (prev?.costEur ?? 0) + r.costEur,
    });
  }

  totals(): ProviderCost[] {
    return [...this.totalsByProvider.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  }

  totalEur(): number {
    return this.totals().reduce((sum, t) => sum + t.costEur, 0);
  }
}

export class AllProvidersFailedError extends Error {
  constructor(readonly tier: ModelTier, readonly cause?: unknown) {
    super(`no provider could serve tier ${tier}`);
    this.name = "AllProvidersFailedError";
  }
}

export interface ComposeOptions {
  /** Per-provider call timeout. */
  readonly timeoutMs?: number;
  /** Per-provider retry policy (default: single attempt, no retry). */
  readonly retry?: { attempts: number; backoffMs: number };
  /** Per-provider circuit breaker (default: disabled). */
  readonly circuit?: { failureThreshold: number; resetMs: number };
  readonly clock?: () => number;
  readonly onAudit?: (audit: ProviderAudit) => void;
  readonly accountant?: CostAccountant;
}

export class ProviderRegistry {
  private readonly entries: ProviderEntry[] = [];

  register(entry: ProviderEntry): void {
    if (this.entries.some((e) => e.provider.name === entry.provider.name)) {
      throw new Error(`provider "${entry.provider.name}" already registered`);
    }
    this.entries.push(entry);
  }

  /** Deterministic candidate order for a tier: priority asc, then name asc. */
  candidates(tier: ModelTier): ModelProvider[] {
    return this.entries
      .filter((e) => e.tiers.includes(tier))
      .sort((a, b) => a.priority - b.priority || a.provider.name.localeCompare(b.provider.name))
      .map((e) => e.provider);
  }

  /** Compose the registry into a single resilient, failover ModelProvider. */
  compose(opts: ComposeOptions): ModelProvider {
    const breakers = new Map<string, CircuitBreaker>();
    const breakerFor = (name: string): CircuitBreaker | null => {
      if (!opts.circuit) return null;
      let b = breakers.get(name);
      if (!b) {
        b = new CircuitBreaker({ ...opts.circuit, clock: opts.clock ?? Date.now });
        breakers.set(name, b);
      }
      return b;
    };

    const callOnce = (provider: ModelProvider, prompt: string, tier: ModelTier): Promise<InvokeResult> => {
      const base = (): Promise<InvokeResult> =>
        opts.timeoutMs !== undefined
          ? withTimeout(() => provider.invoke(prompt, tier), opts.timeoutMs)
          : provider.invoke(prompt, tier);
      const withPolicy = (): Promise<InvokeResult> =>
        opts.retry ? withRetry(base, { attempts: opts.retry.attempts, backoffMs: opts.retry.backoffMs }) : base();
      const breaker = breakerFor(provider.name);
      return breaker ? breaker.exec(withPolicy) : withPolicy();
    };

    const registry = this;
    return {
      name: "registry",
      async invoke(prompt: string, tier: ModelTier): Promise<InvokeResult> {
        const candidates = registry.candidates(tier);
        let order = 0;
        let lastError: unknown;
        for (const provider of candidates) {
          order += 1;
          const breaker = breakerFor(provider.name);
          if (breaker && breaker.state === "open") {
            opts.onAudit?.({ provider: provider.name, tier, outcome: "error", attemptOrder: order, error: "circuit open" });
            continue;
          }
          try {
            const result = await callOnce(provider, prompt, tier);
            opts.accountant?.record(provider.name, result);
            opts.onAudit?.({ provider: provider.name, tier, outcome: order === 1 ? "ok" : "failover", attemptOrder: order });
            return result;
          } catch (error) {
            lastError = error;
            opts.onAudit?.({
              provider: provider.name,
              tier,
              outcome: "error",
              attemptOrder: order,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        throw new AllProvidersFailedError(tier, lastError);
      },
    };
  }
}
