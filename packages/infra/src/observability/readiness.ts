/**
 * Production readiness diagnostics (STEP 10.2). Separates *liveness* (is the
 * process alive) from *readiness* (are the critical dependencies reachable),
 * per ADR-047. Dependency connectivity is injected as ping functions so infra
 * stays decoupled from concrete clients (no new import, boundaries intact).
 *
 * Results are evidence-backed and deterministic: the evidence id is a
 * content-addressed hash of (probe name, criticality, state), independent of
 * timing and registration order — same dependency state ⇒ same evidence (I4,
 * reuses the Evidence Generator's content-addressing discipline, ADR-035).
 */
import { createHash } from "node:crypto";

export type ProbeState = "up" | "down";

export interface DependencyProbe {
  readonly name: string;
  /** Critical probes gate readiness; optional probes are reported but don't block. */
  readonly critical: boolean;
  readonly check: () => Promise<boolean>;
}

export interface ProbeResult {
  readonly name: string;
  readonly critical: boolean;
  readonly state: ProbeState;
  readonly error?: string;
}

export interface ReadinessReport {
  readonly ready: boolean;
  readonly probes: ProbeResult[]; // sorted by name (deterministic)
  readonly evidenceId: string;
}

/** Content-addressed diagnostic evidence: order- and timing-independent (I4). */
export function diagnosticEvidenceId(results: readonly ProbeResult[]): string {
  const canonical = results
    .map((r) => `${r.name}:${r.critical ? "c" : "o"}:${r.state}`)
    .sort()
    .join("|");
  const h = createHash("sha256").update(`readiness|${canonical}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export class ReadinessRegistry {
  private readonly probes = new Map<string, DependencyProbe>();

  register(probe: DependencyProbe): void {
    if (this.probes.has(probe.name)) throw new Error(`readiness probe "${probe.name}" already registered`);
    this.probes.set(probe.name, probe);
  }

  async check(): Promise<ReadinessReport> {
    const names = [...this.probes.keys()].sort();
    const probes: ProbeResult[] = [];
    for (const name of names) {
      const probe = this.probes.get(name)!;
      try {
        const ok = await probe.check();
        probes.push({ name, critical: probe.critical, state: ok ? "up" : "down" });
      } catch (err) {
        probes.push({ name, critical: probe.critical, state: "down", error: err instanceof Error ? err.message : String(err) });
      }
    }
    const ready = probes.filter((p) => p.critical).every((p) => p.state === "up");
    return { ready, probes, evidenceId: diagnosticEvidenceId(probes) };
  }
}

/** Liveness is intentionally dependency-free: it answers "is the event loop alive?". */
export function liveness(): { readonly live: true } {
  return { live: true };
}

/** Startup guard: fail fast and loud, naming the unreachable critical dependencies (ADR-047). */
export async function assertReady(registry: ReadinessRegistry): Promise<ReadinessReport> {
  const report = await registry.check();
  if (!report.ready) {
    const down = report.probes.filter((p) => p.critical && p.state === "down").map((p) => p.name);
    throw new Error(`Startup readiness failed: unreachable critical dependencies: ${down.join(", ")}`);
  }
  return report;
}

const probe = (name: string, ping: () => Promise<unknown>): DependencyProbe => ({
  name,
  critical: true,
  check: () => ping().then(() => true),
});

/** Named critical probes for the core dependencies (ping = any connectivity round-trip). */
export const databaseProbe = (ping: () => Promise<unknown>): DependencyProbe => probe("database", ping);
export const redisProbe = (ping: () => Promise<unknown>): DependencyProbe => probe("redis", ping);
export const aiGatewayProbe = (ping: () => Promise<unknown>): DependencyProbe => probe("ai_gateway", ping);
