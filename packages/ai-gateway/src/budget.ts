/** In-memory BudgetGuard — per workspace+feature spend cap. Postgres-backed guard lands with the ledger (Phase 1). */
import type { BudgetGuard } from "./types.js";

export class InMemoryBudgetGuard implements BudgetGuard {
  private readonly spent = new Map<string, number>();

  constructor(private readonly capEur: number) {}

  private key(ws: string, feature: string): string {
    return `${ws}/${feature}`;
  }

  check(workspaceId: string, feature: string): Promise<{ allowed: boolean; spentEur: number }> {
    const spentEur = this.spent.get(this.key(workspaceId, feature)) ?? 0;
    return Promise.resolve({ allowed: spentEur < this.capEur, spentEur });
  }

  record(workspaceId: string, feature: string, costEur: number): Promise<void> {
    const k = this.key(workspaceId, feature);
    this.spent.set(k, (this.spent.get(k) ?? 0) + costEur);
    return Promise.resolve();
  }
}
