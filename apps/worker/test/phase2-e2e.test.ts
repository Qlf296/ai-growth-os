/**
 * Phase 2.10 — end-to-end validation of the whole GSC integration:
 * connect → select property → schedule → scheduler tick → queue → authenticated
 * sync (refresh) → raw-first → normalize → signals, with health, sync metadata,
 * audit, RLS isolation, vault isolation, incremental resume, idempotency,
 * token rotation and revoked-credential handling. Fixtures only, real Postgres.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AdapterError,
  FixtureGscTransport,
  InMemoryRateCounter,
  QuotaGuard,
  checkConnectionHealth,
  refreshConnectionToken,
  type GoogleTokenEndpoint,
} from "@aigos/adapters";
import { ConfigRegistry, InMemoryConfigStore } from "@aigos/config-registry";
import {
  ConnectionRepository,
  TokenVault,
  getSyncState,
  scheduleWorkspaceJob,
  withWorkspace,
} from "@aigos/database";
import { FsRawStore, InMemoryJobQueue, MetricsRegistry } from "@aigos/infra";

import { createGscIngestionHandler, registerGscQuotaKeys } from "../src/ingestion.js";
import { tick, type JobDefinition, type SchedulerPayload } from "../src/scheduler.js";
import { startHarness, seedWorkspace, type Harness } from "../../../packages/database/test/harness.js";

const FIXTURES = join(__dirname, "..", "..", "..", "packages", "adapters", "src", "gsc", "fixtures");

let h: Harness;
let vault: TokenVault;
const WS = randomUUID();
const OTHER_WS = randomUUID();
const USER = randomUUID();
const SITE = "sc-domain:forgcv.com";
let connectionId = "";
let now = new Date("2026-07-12T06:00:00Z");
const clock = () => now;

const endpoint = (over: Partial<GoogleTokenEndpoint> = {}): GoogleTokenEndpoint => ({
  exchangeCode: async () => ({ accessToken: "ya29.INIT", refreshToken: "1//R", expiresInSeconds: 3600 }),
  refreshToken: async () => ({ accessToken: "ya29.FRESH", expiresInSeconds: 3600 }),
  ...over,
});

const handlerDeps = (globalPerMinute = 1000) => {
  const config = new ConfigRegistry(new InMemoryConfigStore());
  registerGscQuotaKeys(config);
  const metrics = new MetricsRegistry();
  return {
    deps: {
      pool: h.app,
      rawStore: new FsRawStore(mkdtempSync(join(tmpdir(), "e2e-raw-"))),
      transport: new FixtureGscTransport(FIXTURES),
      config,
      metrics,
      quota: new QuotaGuard(new InMemoryRateCounter(clock), clock, { globalPerMinute, perWorkspacePerMinute: 500 }),
    },
    metrics,
  };
};

const runScheduledSync = async (scheduledFor: string, globalPerMinute = 1000) => {
  now = new Date(scheduledFor);
  const row = await h.admin.query(
    `SELECT id, params FROM scheduled_jobs WHERE workspace_id = $1 AND job_family = 'gsc.ingest.daily'`,
    [WS],
  );
  const def: JobDefinition = {
    id: row.rows[0].id, workspaceId: WS, jobFamily: "gsc.ingest.daily", schedule: "0 6 * * *", params: row.rows[0].params,
  };
  const q = new InMemoryJobQueue<SchedulerPayload>({ attempts: 2, backoffMs: 0 });
  const { deps, metrics } = handlerDeps(globalPerMinute);
  await tick([def], q, {
    windowStart: new Date(new Date(scheduledFor).getTime() - 120_000),
    now: new Date(new Date(scheduledFor).getTime() + 60_000),
  });
  q.process(createGscIngestionHandler(deps));
  await q.drain();
  return { q, metrics };
};

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "forgcv");
  await seedWorkspace(h.admin, OTHER_WS, "other");
  await h.admin.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@t.dev', 'magic_link')`, [USER]);
  vault = new TokenVault(h.vault, { encryptionKeyHex: "1".repeat(64), keyId: "k1" }, clock);
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe("connection + credential lifecycle", () => {
  it("connects a workspace-owned GSC connection and vaults the tokens (I8)", async () => {
    connectionId = await withWorkspace(h.app, WS, (tx) =>
      new ConnectionRepository().create(tx, {
        provider: "gsc", scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
        capabilities: { read_search_analytics: true }, authorizedBy: USER,
      }),
    );
    await vault.storeTokens(WS, connectionId, { accessToken: "ya29.INIT", refreshToken: "1//R", expiresAt: new Date(now.getTime() + 3600_000) });
    // I8: the app role cannot read provider_tokens
    await expect(withWorkspace(h.app, WS, (tx) => tx.query(`SELECT * FROM provider_tokens`))).rejects.toThrow(/permission denied/);
    const conn = await withWorkspace(h.app, WS, (tx) => new ConnectionRepository().get(tx, connectionId));
    expect(conn?.healthStatus).toBe("pending");
  });

  it("selects a property and schedules the recurring sync (schedules-as-data)", async () => {
    await withWorkspace(h.app, WS, (tx) => new ConnectionRepository().setSite(tx, connectionId, SITE));
    await scheduleWorkspaceJob(h.app, { workspaceId: WS, jobFamily: "gsc.ingest.daily", schedule: "0 6 * * *", params: { workspaceId: WS, connectionId, siteUrl: SITE } });
    const job = await h.admin.query(`SELECT enabled FROM scheduled_jobs WHERE workspace_id = $1`, [WS]);
    expect(job.rows[0].enabled).toBe(true);
  });
});

describe("initial synchronization through scheduler + queue", () => {
  it("tick → queue → sync produces signals, sync metadata, health and audit", async () => {
    const { metrics } = await runScheduledSync("2026-07-12T06:00:00Z");
    expect((await h.admin.query(`SELECT count(*)::int AS n FROM signals WHERE workspace_id = $1`, [WS])).rows[0].n).toBe(4);
    const state = (await getSyncState(h.app, WS, connectionId))!;
    expect(state.lastSuccessfulSync?.toISOString().slice(0, 10)).toBe("2026-07-10");
    expect(state.importedRows).toBe(4);
    expect(state.lastError).toBeNull();
    const health = await withWorkspace(h.app, WS, (tx) => new ConnectionRepository().get(tx, connectionId));
    expect(health?.healthStatus).toBe("healthy");
    expect(metrics.snapshot().counters["ingest.signals_inserted"]).toBe(4);
    expect(metrics.snapshot().counters["connection.health.healthy"]).toBe(1);
    for (const ev of ["ingestion.completed", "connection.health_changed"]) {
      const a = await h.admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE event = $1 AND workspace_id = $2`, [ev, WS]);
      expect(a.rows[0].n, ev).toBeGreaterThanOrEqual(1);
    }
  });

  it("raw-first: every signal references an immutable stored raw payload", async () => {
    const refs = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT DISTINCT payload_ref FROM signals WHERE workspace_id = $1`, [WS]));
    expect(refs.rowCount).toBeGreaterThanOrEqual(1);
    for (const row of refs.rows as { payload_ref: string }[]) expect(row.payload_ref).toContain(`${WS}/gsc/`);
  });

  it("RLS: another workspace sees none of these signals", async () => {
    expect((await withWorkspace(h.app, OTHER_WS, (tx) => tx.query(`SELECT * FROM signals`))).rowCount).toBe(0);
  });
});

describe("incremental + idempotency", () => {
  it("a later run syncs only the new days; re-running the same window adds nothing", async () => {
    await runScheduledSync("2026-07-13T06:00:00Z"); // target 07-11
    const state = (await getSyncState(h.app, WS, connectionId))!;
    expect(state.lastSuccessfulSync?.toISOString().slice(0, 10)).toBe("2026-07-11");
    const before = (await h.admin.query(`SELECT count(*)::int AS n FROM signals WHERE workspace_id = $1`, [WS])).rows[0].n;
    await runScheduledSync("2026-07-13T06:00:00Z"); // up-to-date
    const after = (await h.admin.query(`SELECT count(*)::int AS n FROM signals WHERE workspace_id = $1`, [WS])).rows[0].n;
    expect(after).toBe(before);
  });
});

describe("OAuth token lifecycle", () => {
  it("rotates the refresh token when Google issues a new one (audited, vaulted)", async () => {
    now = new Date("2026-07-14T06:00:00Z");
    await vault.storeTokens(WS, connectionId, { accessToken: "ya29.OLD", refreshToken: "1//R", expiresAt: new Date(now.getTime() - 3600_000) });
    const rotating = endpoint({ refreshToken: async () => ({ accessToken: "ya29.ROT", refreshToken: "1//NEW", expiresInSeconds: 3600 }) });
    const token = await refreshConnectionToken({ pool: h.app, vault, endpoint: rotating, workspaceId: WS, connectionId, clock });
    expect(token).toBe("ya29.ROT");
    expect((await vault.getTokens(WS, connectionId))?.refreshToken).toBe("1//NEW");
    expect((await h.admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE event = 'token.rotated'`)).rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("revoked refresh token → reconnect_required + expired status + audit", async () => {
    await vault.storeTokens(WS, connectionId, { accessToken: "ya29.OLD", refreshToken: "1//NEW", expiresAt: new Date(now.getTime() - 3600_000) });
    const revoked = endpoint({ refreshToken: async () => { throw new AdapterError("auth", "invalid_grant"); } });
    const result = await checkConnectionHealth({
      pool: h.app, vault, endpoint: revoked, workspaceId: WS, connectionId, clock,
      transportFactory: () => new FixtureGscTransport(FIXTURES),
    });
    expect(result.health).toBe("reconnect_required");
    expect((await h.admin.query(`SELECT status FROM connections WHERE id = $1`, [connectionId])).rows[0].status).toBe("expired");
    expect((await h.admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE event = 'token.refresh_failed'`)).rows[0].n).toBeGreaterThanOrEqual(1);
  });
});
