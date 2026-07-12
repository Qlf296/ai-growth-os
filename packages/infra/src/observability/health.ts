/** Health check registry — consumed by /health (api) and the worker heartbeat. */

export type HealthCheck = () => Promise<boolean>;

export interface HealthReport {
  readonly healthy: boolean;
  readonly checks: Record<string, boolean>;
}

export class HealthRegistry {
  private readonly checks = new Map<string, HealthCheck>();

  register(name: string, check: HealthCheck): void {
    if (this.checks.has(name)) throw new Error(`health check "${name}" already registered`);
    this.checks.set(name, check);
  }

  async run(): Promise<HealthReport> {
    const checks: Record<string, boolean> = {};
    for (const [name, check] of this.checks) {
      checks[name] = await check().catch(() => false); // a throwing check fails, never crashes
    }
    return { healthy: Object.values(checks).every(Boolean), checks };
  }
}
