/**
 * Phase 2.8 — GSC connection health monitoring (ADR-021 health model).
 * Automatic token refresh, revoked/expired detection, retry after refresh,
 * health-state transitions, audit + metrics. Fixtures only.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConnectionRepository, TokenVault, withWorkspace } from "@aigos/database";
import { MetricsRegistry } from "@aigos/infra";

import {
  AdapterError,
  checkConnectionHealth,
  healthForErrorKind,
  type GoogleTokenEndpoint,
  type GscTransport,
} from "../src/index.js";
import { startHarness, seedWorkspace, type Harness } from "../../database/test/harness.js";

let h: Harness;
let vault: TokenVault;
const WS = randomUUID();
const USER = randomUUID();
let now = new Date("2026-07-12T10:00:00Z");
const clock = () => now;

const liveTransport: GscTransport = {
  listSites: async () => ({ siteEntry: [] }),
  querySearchAnalytics: async () => ({ rows: [] }),
};
const revokedTransport: GscTransport = {
  listSites: async () => {
    throw new AdapterError("capability_revoked", "user revoked access");
  },
  querySearchAnalytics: async () => ({ rows: [] }),
};
const flakyTransport: GscTransport = {
  listSites: async () => {
    throw new AdapterError("transient", "503");
  },
  querySearchAnalytics: async () => ({ rows: [] }),
};

const okEndpoint = (refreshCalls = { n: 0 }): GoogleTokenEndpoint => ({
  exchangeCode: async () => ({ accessToken: "a", refreshToken: "1//R", expiresInSeconds: 3600 }),
  refreshToken: async () => {
    refreshCalls.n++;
    return { accessToken: "ya29.FRESH", expiresInSeconds: 3600 };
  },
});
const authFailEndpoint: GoogleTokenEndpoint = {
  exchangeCode: async () => ({ accessToken: "a", refreshToken: "1//R", expiresInSeconds: 3600 }),
  refreshToken: async () => {
    throw new AdapterError("auth", "invalid_grant");
  },
};

async function newConnection(): Promise<string> {
  const id = await withWorkspace(h.app, WS, (tx) =>
    new ConnectionRepository().create(tx, { provider: "gsc", scopes: [], capabilities: { read_search_analytics: true }, authorizedBy: USER }),
  );
  return id;
}
const health = async (id: string): Promise<string> =>
  (await h.admin.query(`SELECT health_status FROM connections WHERE id = $1`, [id])).rows[0].health_status;
const status = async (id: string): Promise<string> =>
  (await h.admin.query(`SELECT status FROM connections WHERE id = $1`, [id])).rows[0].status;

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  await h.admin.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@t.dev', 'magic_link')`, [USER]);
  vault = new TokenVault(h.vault, { encryptionKeyHex: "e".repeat(64), keyId: "k1" }, clock);
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe("healthForErrorKind mapping", () => {
  it("auth→reconnect_required, capability_revoked→failed, transient/quota→degraded", () => {
    expect(healthForErrorKind("auth")).toBe("reconnect_required");
    expect(healthForErrorKind("capability_revoked")).toBe("failed");
    expect(healthForErrorKind("transient")).toBe("degraded");
    expect(healthForErrorKind("quota")).toBe("degraded");
  });
});

describe("checkConnectionHealth", () => {
  const base = (id: string, endpoint: GoogleTokenEndpoint, transport: GscTransport, metrics: MetricsRegistry) => ({
    pool: h.app, vault, endpoint, workspaceId: WS, connectionId: id, clock, metrics,
    transportFactory: () => transport,
  });

  it("pending → healthy on a live probe; transition audited and metered", async () => {
    const id = await newConnection();
    await vault.storeTokens(WS, id, { accessToken: "ya29.OK", refreshToken: "1//R", expiresAt: new Date(now.getTime() + 3600_000) });
    const metrics = new MetricsRegistry();
    const result = await checkConnectionHealth(base(id, okEndpoint(), liveTransport, metrics));
    expect(result.health).toBe("healthy");
    expect(await health(id)).toBe("healthy");
    expect(metrics.snapshot().counters["connection.health.healthy"]).toBe(1);
    const audit = await h.admin.query(
      `SELECT details FROM audit_log WHERE event = 'connection.health_changed' AND workspace_id = $1 AND details->>'connectionId' = $2 ORDER BY id DESC LIMIT 1`,
      [WS, id],
    );
    expect(audit.rows[0].details).toMatchObject({ from: "pending", to: "healthy" });
  });

  it("expired access token is auto-refreshed, then the probe succeeds (retry after refresh)", async () => {
    const id = await newConnection();
    await vault.storeTokens(WS, id, { accessToken: "ya29.OLD", refreshToken: "1//R", expiresAt: new Date(now.getTime() - 3600_000) });
    const refreshCalls = { n: 0 };
    const result = await checkConnectionHealth(base(id, okEndpoint(refreshCalls), liveTransport, new MetricsRegistry()));
    expect(refreshCalls.n).toBe(1);
    expect(result.health).toBe("healthy");
    expect((await vault.getTokens(WS, id))?.accessToken).toBe("ya29.FRESH");
  });

  it("invalid_grant on refresh → reconnect_required + connection status expired (ADR-019)", async () => {
    const id = await newConnection();
    await vault.storeTokens(WS, id, { accessToken: "ya29.OLD", refreshToken: "1//R", expiresAt: new Date(now.getTime() - 3600_000) });
    const result = await checkConnectionHealth(base(id, authFailEndpoint, liveTransport, new MetricsRegistry()));
    expect(result.health).toBe("reconnect_required");
    expect(await health(id)).toBe("reconnect_required");
    expect(await status(id)).toBe("expired");
  });

  it("revoked permission → failed (permanent); a later live probe does NOT auto-recover", async () => {
    const id = await newConnection();
    await vault.storeTokens(WS, id, { accessToken: "ya29.OK", refreshToken: "1//R", expiresAt: new Date(now.getTime() + 3600_000) });
    const revoked = await checkConnectionHealth(base(id, okEndpoint(), revokedTransport, new MetricsRegistry()));
    expect(revoked.health).toBe("failed");
    expect(await health(id)).toBe("failed");
    const retry = await checkConnectionHealth(base(id, okEndpoint(), liveTransport, new MetricsRegistry()));
    expect(retry.health).toBe("failed"); // terminal until explicit reconnect
    expect(await health(id)).toBe("failed");
  });

  it("temporary Google failure → degraded (queue backoff retries); status untouched", async () => {
    const id = await newConnection();
    await vault.storeTokens(WS, id, { accessToken: "ya29.OK", refreshToken: "1//R", expiresAt: new Date(now.getTime() + 3600_000) });
    const result = await checkConnectionHealth(base(id, okEndpoint(), flakyTransport, new MetricsRegistry()));
    expect(result.health).toBe("degraded");
    expect(await status(id)).toBe("active");
  });

  it("repeated identical health is idempotent: only the first change is audited", async () => {
    const id = await newConnection();
    await vault.storeTokens(WS, id, { accessToken: "ya29.OK", refreshToken: "1//R", expiresAt: new Date(now.getTime() + 3600_000) });
    await checkConnectionHealth(base(id, okEndpoint(), liveTransport, new MetricsRegistry()));
    await checkConnectionHealth(base(id, okEndpoint(), liveTransport, new MetricsRegistry()));
    const audits = await h.admin.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE event = 'connection.health_changed' AND details->>'connectionId' = $1`,
      [id],
    );
    expect(audits.rows[0].n).toBe(1);
  });
});
