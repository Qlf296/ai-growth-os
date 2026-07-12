/**
 * Phase 2.1 — adapter foundation (ADR-021 operational contract; ADR-007
 * capabilities-as-data; ADR-019 reauth semantics). No provider code, no
 * network: a fake adapter exercises the framework on real Postgres.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConfigRegistry, InMemoryConfigStore, int } from "@aigos/config-registry";
import { ConnectionRepository, withWorkspace } from "@aigos/database";

import {
  AdapterError,
  AdapterRegistry,
  applyConnectionStatus,
  classifyError,
  registerAdapterConfig,
  requireCapability,
  runHealthCheck,
  type Adapter,
} from "../src/index.js";
import { startHarness, seedWorkspace, type Harness } from "../../database/test/harness.js";

const makeAdapter = (over: Partial<Adapter> = {}): Adapter => ({
  descriptor: {
    provider: "fakeprov",
    apiVersion: "v1",
    capabilities: { read_metrics: true, publish: "deeplink_only", read_feed: false },
    deprecationCheckJobFamily: "fakeprov.deprecation_check",
    configKeys: [
      {
        key: "adapters.fakeprov.poll_batch_size",
        description: "rows per poll",
        owner: "ingestion",
        stability: "experiment",
        decisionAffecting: false,
        schema: int({ min: 1, max: 1000 }),
        defaultValue: 100,
      },
    ],
  },
  healthCheck: async () => {},
  ...over,
});

describe("AdapterRegistry", () => {
  it("register/resolve; duplicates refused; unknown provider fails loudly", () => {
    const r = new AdapterRegistry();
    r.register(makeAdapter());
    expect(r.resolve("fakeprov").descriptor.apiVersion).toBe("v1");
    expect(() => r.register(makeAdapter())).toThrow(/already registered/i);
    expect(() => r.resolve("nope")).toThrow(/no adapter registered/i);
    expect(r.list().map((a) => a.descriptor.provider)).toEqual(["fakeprov"]);
  });
});

describe("capabilities manifest (ADR-007 — pipelines consult capabilities, never provider names)", () => {
  const manifest = makeAdapter().descriptor.capabilities;

  it("requireCapability passes for granted, throws typed capability error otherwise", () => {
    expect(requireCapability(manifest, "read_metrics")).toBe(true);
    expect(requireCapability(manifest, "publish")).toBe("deeplink_only");
    for (const missing of ["read_feed", "unknown_cap"]) {
      try {
        requireCapability(manifest, missing);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(AdapterError);
        expect((error as AdapterError).kind).toBe("capability_revoked");
      }
    }
  });
});

describe("failure honesty (ADR-021 §6 taxonomy)", () => {
  it("classifyError keeps typed AdapterErrors and maps everything else to transient", () => {
    const auth = new AdapterError("auth", "token expired");
    expect(classifyError(auth)).toBe(auth);
    const unknown = classifyError(new Error("ECONNRESET"));
    expect(unknown.kind).toBe("transient");
    expect(unknown.message).toContain("ECONNRESET");
  });
});

describe("adapter configuration (reuses ADR-046 registry — tunables are data)", () => {
  it("registerAdapterConfig defines the adapter's keys; reads come from the registry", async () => {
    const config = new ConfigRegistry(new InMemoryConfigStore());
    registerAdapterConfig(config, makeAdapter().descriptor);
    expect(await config.get("adapters.fakeprov.poll_batch_size")).toBe(100);
    expect(() => registerAdapterConfig(config, makeAdapter().descriptor)).toThrow(/already defined/i);
  });
});

describe("lifecycle + health on real Postgres", () => {
  let h: Harness;
  const WS = randomUUID();
  const USER = randomUUID();
  let connectionId = "";
  const repo = new ConnectionRepository();

  beforeAll(async () => {
    h = await startHarness();
    await seedWorkspace(h.admin, WS, "ws");
    await h.admin.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@t.dev', 'magic_link')`, [USER]);
    connectionId = await withWorkspace(h.app, WS, (tx) =>
      repo.create(tx, { provider: "fakeprov", scopes: [], capabilities: { read_metrics: true }, authorizedBy: USER }),
    );
  }, 120_000);

  afterAll(async () => {
    await h.stop();
  });

  it("status transitions follow the S3 state machine; illegal jumps throw", async () => {
    await applyConnectionStatus(h.app, WS, connectionId, "expired");   // active → expired (ok)
    await applyConnectionStatus(h.app, WS, connectionId, "active");    // expired → active (reauth, ADR-019)
    await expect(
      applyConnectionStatus(h.app, WS, connectionId, "active"),        // active → active: not a transition
    ).rejects.toThrow(/illegal status transition/i);
  });

  it("healthy check: status untouched, health_checked_at stamped", async () => {
    const result = await runHealthCheck(h.app, WS, connectionId, makeAdapter());
    expect(result).toEqual({ healthy: true });
    const row = await h.admin.query(`SELECT status, health_checked_at FROM connections WHERE id = $1`, [connectionId]);
    expect(row.rows[0].status).toBe("active");
    expect(row.rows[0].health_checked_at).not.toBeNull();
  });

  it("auth failure → status 'expired' (reauth semantics), reported not thrown", async () => {
    const failing = makeAdapter({
      healthCheck: async () => {
        throw new AdapterError("auth", "refresh token invalid");
      },
    });
    const result = await runHealthCheck(h.app, WS, connectionId, failing);
    expect(result).toEqual({ healthy: false, kind: "auth", message: "refresh token invalid" });
    const row = await h.admin.query(`SELECT status FROM connections WHERE id = $1`, [connectionId]);
    expect(row.rows[0].status).toBe("expired");
    await applyConnectionStatus(h.app, WS, connectionId, "active"); // restore for next test
  });

  it("transient failure → status untouched (no user-facing surprise for a blip)", async () => {
    const flaky = makeAdapter({
      healthCheck: async () => {
        throw new Error("socket hang up");
      },
    });
    const result = await runHealthCheck(h.app, WS, connectionId, flaky);
    expect(result.healthy).toBe(false);
    expect((result as { kind: string }).kind).toBe("transient");
    const row = await h.admin.query(`SELECT status FROM connections WHERE id = $1`, [connectionId]);
    expect(row.rows[0].status).toBe("active");
  });

  it("capability_revoked → status 'error'", async () => {
    const revoked = makeAdapter({
      healthCheck: async () => {
        throw new AdapterError("capability_revoked", "scope removed by provider");
      },
    });
    await runHealthCheck(h.app, WS, connectionId, revoked);
    const row = await h.admin.query(`SELECT status FROM connections WHERE id = $1`, [connectionId]);
    expect(row.rows[0].status).toBe("error");
  });
});
