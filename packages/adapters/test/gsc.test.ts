/**
 * Phase 2.2 — GSC adapter foundation (S7 §1.1; ADR-021).
 * Offline only: fixtures are the sandbox. Raw-first: the payload is stored
 * immutably BEFORE validation; normalization emits Signals (S3 §4).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConfigRegistry, InMemoryConfigStore } from "@aigos/config-registry";
import { ConnectionRepository, withWorkspace } from "@aigos/database";
import { FsRawStore } from "@aigos/infra";

import { AdapterRegistry, AdapterError, registerAdapterConfig } from "../src/index.js";
import {
  FixtureGscTransport,
  createGscAdapter,
  ingestSearchAnalytics,
  type GscTransport,
} from "../src/gsc/index.js";
import { startHarness, seedWorkspace, type Harness } from "../../database/test/harness.js";

const FIXTURES = join(__dirname, "..", "src", "gsc", "fixtures");

let h: Harness;
const WS_A = randomUUID();
const WS_B = randomUUID();
const USER = randomUUID();
let connectionId = "";
let store: FsRawStore;

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS_A, "A");
  await seedWorkspace(h.admin, WS_B, "B");
  await h.admin.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@t.dev', 'magic_link')`, [USER]);
  connectionId = await withWorkspace(h.app, WS_A, (tx) =>
    new ConnectionRepository().create(tx, {
      provider: "gsc",
      scopes: ["webmasters.readonly"],
      capabilities: { read_search_analytics: true },
      authorizedBy: USER,
    }),
  );
  store = new FsRawStore(mkdtempSync(join(tmpdir(), "gsc-raw-")));
}, 120_000);

afterAll(async () => {
  await h.stop();
});

const ingest = (transport: GscTransport, capturedAt = new Date("2026-07-12T06:00:00Z")) =>
  ingestSearchAnalytics({
    pool: h.app,
    rawStore: store,
    transport,
    workspaceId: WS_A,
    connectionId,
    siteUrl: "sc-domain:forgcv.com",
    startDate: "2026-07-08",
    endDate: "2026-07-09",
    capturedAt,
  });

describe("manifest + registration (ADR-021 §1)", () => {
  it("declares GSC reality as data: read yes, publish no, 2-day lag, 16-month backfill", () => {
    const adapter = createGscAdapter(new FixtureGscTransport(FIXTURES));
    expect(adapter.descriptor.provider).toBe("gsc");
    expect(adapter.descriptor.capabilities).toMatchObject({
      read_search_analytics: true,
      publish: false,
      backfill_months: "16",
    });
    expect(adapter.descriptor.deprecationCheckJobFamily).toBe("gsc.deprecation_check");
    const registry = new AdapterRegistry();
    registry.register(adapter);
    expect(registry.resolve("gsc")).toBe(adapter);
  });

  it("its tunables land in the ADR-046 registry (data lag = 2 days, S7 §1.1 — never 'today's SEO')", async () => {
    const config = new ConfigRegistry(new InMemoryConfigStore());
    registerAdapterConfig(config, createGscAdapter(new FixtureGscTransport(FIXTURES)).descriptor);
    expect(await config.get("adapters.gsc.data_lag_days")).toBe(2);
    expect(await config.get("adapters.gsc.backfill_chunk_days")).toBe(30);
  });
});

describe("health check through the framework", () => {
  it("fixture transport is healthy; an auth-failing transport reports kind auth", async () => {
    const ok = createGscAdapter(new FixtureGscTransport(FIXTURES));
    await expect(ok.healthCheck({ connectionId, workspaceId: WS_A })).resolves.toBeUndefined();
    const failing = createGscAdapter({
      querySearchAnalytics: async () => {
        throw new AdapterError("auth", "invalid_grant");
      },
    });
    await expect(failing.healthCheck({ connectionId, workspaceId: WS_A })).rejects.toThrow(/invalid_grant/);
  });
});

describe("raw-first ingestion (S2 §3; S3 §4)", () => {
  it("stores the raw payload, validates, normalizes rows into Signals", async () => {
    const result = await ingest(new FixtureGscTransport(FIXTURES));
    expect(result.inserted).toBe(4);
    expect(result.rawRef).toMatch(new RegExp(`^${WS_A}/gsc/2026-07-12/`));
    const raw = JSON.parse((await store.get(result.rawRef)).toString());
    expect(raw.rows).toHaveLength(4);

    const signals = await withWorkspace(h.app, WS_A, (tx) =>
      tx.query(`SELECT source, type, data, payload_ref, normalizer_version, occurred_at FROM signals ORDER BY occurred_at, data->>'query'`),
    );
    expect(signals.rowCount).toBe(4);
    const first = signals.rows[0] as {
      source: string; type: string; payload_ref: string; normalizer_version: number;
      data: { query: string; page: string; clicks: number; impressions: number; ctr: number; position: number };
    };
    expect(first.source).toBe("gsc");
    expect(first.type).toBe("gsc.search_analytics.daily");
    expect(first.payload_ref).toBe(result.rawRef);
    expect(first.normalizer_version).toBe(1);
    expect(first.data.impressions).toBeGreaterThan(0);
  });

  it("re-ingesting the same window is idempotent (dedupe_hash — retries are free)", async () => {
    const again = await ingest(new FixtureGscTransport(FIXTURES), new Date("2026-07-12T07:00:00Z"));
    expect(again.inserted).toBe(0);
    expect(again.duplicates).toBe(4);
  });

  it("malformed provider response: raw is STILL stored, validation fails loudly, zero signals", async () => {
    const malformed: GscTransport = { querySearchAnalytics: async () => ({ unexpected: "shape" }) };
    let thrown: unknown;
    try {
      await ingest(malformed, new Date("2026-07-12T08:00:00Z"));
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).toMatch(/GSC response validation/i);
    const rawRef = (thrown as { rawRef: string }).rawRef;
    expect(rawRef).toBeTruthy();
    const raw = JSON.parse((await store.get(rawRef)).toString());
    expect(raw).toEqual({ unexpected: "shape" }); // raw-first: stored before validation
    const count = await h.admin.query(`SELECT count(*)::int AS n FROM signals`);
    expect(count.rows[0].n).toBe(4); // unchanged
  });

  it("signals are tenant-isolated (AT-9 holds for the new table)", async () => {
    const fromB = await withWorkspace(h.app, WS_B, (tx) => tx.query(`SELECT * FROM signals`));
    expect(fromB.rowCount).toBe(0);
  });
});
