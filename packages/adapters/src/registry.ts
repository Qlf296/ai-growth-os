/** Adapter registry — resolution is by provider name at the edge only; everything inside uses capabilities. */
import type { Adapter } from "./types.js";

export class AdapterRegistry {
  private readonly adapters = new Map<string, Adapter>();

  register(adapter: Adapter): void {
    const { provider } = adapter.descriptor;
    if (this.adapters.has(provider)) {
      throw new Error(`Adapter for "${provider}" already registered`);
    }
    this.adapters.set(provider, adapter);
  }

  resolve(provider: string): Adapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new Error(`No adapter registered for provider "${provider}"`);
    return adapter;
  }

  list(): Adapter[] {
    return [...this.adapters.values()];
  }
}
