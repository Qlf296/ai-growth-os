/**
 * Phase 2.9 — production OAuth token lifecycle (I8; ADR-016/017/019).
 * Auto refresh, refresh-token rotation, revoked detection → reconnect_required,
 * and audited token lifecycle events. Credentials never leave the vault.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConnectionRepository, TokenVault, withWorkspace } from "@aigos/database";

import { AdapterError, refreshConnectionToken, type GoogleTokenEndpoint } from "../src/index.js";
import { startHarness, seedWorkspace, type Harness } from "../../database/test/harness.js";

let h: Harness;
let vault: TokenVault;
const WS = randomUUID();
const USER = randomUUID();
let now = new Date("2026-07-12T10:00:00Z");
const clock = () => now;

async function connection(): Promise<string> {
  return withWorkspace(h.app, WS, (tx) =>
    new ConnectionRepository().create(tx, { provider: "gsc", scopes: [], capabilities: {}, authorizedBy: USER }),
  );
}
const events = async (connectionId: string): Promise<string[]> => {
  const r = await h.admin.query(
    `SELECT event FROM audit_log WHERE event LIKE 'token.%' AND details->>'connectionId' = $1 ORDER BY id`,
    [connectionId],
  );
  return r.rows.map((row: { event: string }) => row.event);
};
const status = async (id: string): Promise<string> =>
  (await h.admin.query(`SELECT status FROM connections WHERE id = $1`, [id])).rows[0].status;

const refreshOnly: GoogleTokenEndpoint = {
  exchangeCode: async () => ({ accessToken: "a", refreshToken: "1//R", expiresInSeconds: 3600 }),
  refreshToken: async () => ({ accessToken: "ya29.REFRESHED", expiresInSeconds: 3600 }),
};
const rotating: GoogleTokenEndpoint = {
  exchangeCode: async () => ({ accessToken: "a", refreshToken: "1//R", expiresInSeconds: 3600 }),
  refreshToken: async () => ({ accessToken: "ya29.ROT", refreshToken: "1//NEW-REFRESH", expiresInSeconds: 3600 }),
};
const revoked: GoogleTokenEndpoint = {
  exchangeCode: async () => ({ accessToken: "a", refreshToken: "1//R", expiresInSeconds: 3600 }),
  refreshToken: async () => {
    throw new AdapterError("auth", "invalid_grant");
  },
};

const params = (id: string, endpoint: GoogleTokenEndpoint) => ({
  pool: h.app, vault, endpoint, workspaceId: WS, connectionId: id, clock,
});

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  await h.admin.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@t.dev', 'magic_link')`, [USER]);
  vault = new TokenVault(h.vault, { encryptionKeyHex: "f".repeat(64), keyId: "k1" }, clock);
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe("refreshConnectionToken lifecycle", () => {
  it("a still-valid access token is returned without a refresh or any lifecycle event", async () => {
    const id = await connection();
    await vault.storeTokens(WS, id, { accessToken: "ya29.OK", refreshToken: "1//R", expiresAt: new Date(now.getTime() + 3600_000) });
    expect(await refreshConnectionToken(params(id, refreshOnly))).toBe("ya29.OK");
    expect(await events(id)).toEqual([]);
  });

  it("expired token → refreshed in place, vault access updated, 'token.refreshed' audited", async () => {
    const id = await connection();
    await vault.storeTokens(WS, id, { accessToken: "ya29.OLD", refreshToken: "1//R", expiresAt: new Date(now.getTime() - 3600_000) });
    expect(await refreshConnectionToken(params(id, refreshOnly))).toBe("ya29.REFRESHED");
    const stored = await vault.getTokens(WS, id);
    expect(stored?.accessToken).toBe("ya29.REFRESHED");
    expect(stored?.refreshToken).toBe("1//R"); // unchanged
    expect(await events(id)).toContain("token.refreshed");
  });

  it("Google returns a NEW refresh token → rotation persisted to the vault, 'token.rotated' audited", async () => {
    const id = await connection();
    await vault.storeTokens(WS, id, { accessToken: "ya29.OLD", refreshToken: "1//R", expiresAt: new Date(now.getTime() - 3600_000) });
    expect(await refreshConnectionToken(params(id, rotating))).toBe("ya29.ROT");
    const stored = await vault.getTokens(WS, id);
    expect(stored?.accessToken).toBe("ya29.ROT");
    expect(stored?.refreshToken).toBe("1//NEW-REFRESH"); // rotated
    expect(await events(id)).toContain("token.rotated");
  });

  it("revoked refresh token → auth error, connection status expired, 'token.refresh_failed' audited (permanent)", async () => {
    const id = await connection();
    await vault.storeTokens(WS, id, { accessToken: "ya29.OLD", refreshToken: "1//R", expiresAt: new Date(now.getTime() - 3600_000) });
    await expect(refreshConnectionToken(params(id, revoked))).rejects.toThrow(/invalid_grant/);
    expect(await status(id)).toBe("expired");
    expect(await events(id)).toContain("token.refresh_failed");
  });

  it("no token material ever appears in the audit log", async () => {
    const id = await connection();
    await vault.storeTokens(WS, id, { accessToken: "ya29.OLD", refreshToken: "1//SECRET", expiresAt: new Date(now.getTime() - 3600_000) });
    await refreshConnectionToken(params(id, rotating));
    const raw = await h.admin.query(`SELECT details FROM audit_log WHERE details->>'connectionId' = $1`, [id]);
    const blob = JSON.stringify(raw.rows);
    expect(blob).not.toContain("1//");
    expect(blob).not.toContain("ya29");
  });
});
