/**
 * Phase 2.4 — Google OAuth infrastructure (ADR-019 workspace-owned
 * connections; I8 tokens are sacred). Offline: a fake token endpoint stands
 * in for Google; the real fetch transport is a thin untested-here shell.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TokenVault } from "@aigos/database";

import {
  AdapterError,
  buildGoogleAuthUrl,
  refreshConnectionToken,
  signOAuthState,
  verifyOAuthState,
  type GoogleTokenEndpoint,
} from "../src/index.js";
import { startHarness, seedWorkspace, type Harness } from "../../database/test/harness.js";

const HMAC_KEY = "state-hmac-key-for-tests";
const ENC_KEY = "a".repeat(64); // 32 bytes hex — key custody outside DB (I8)

let h: Harness;
const WS = randomUUID();
const USER = randomUUID();
let connectionId = "";
let vault: TokenVault;
const clock = () => new Date("2026-07-12T10:00:00Z");

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  await h.admin.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@t.dev', 'magic_link')`, [USER]);
  const c = await h.admin.query(
    `INSERT INTO connections (workspace_id, provider, status, scopes, capabilities, authorized_by)
     VALUES ($1, 'gsc', 'active', '{}', '{}', $2) RETURNING id`,
    [WS, USER],
  );
  connectionId = c.rows[0].id;
  vault = new TokenVault(h.vault, { encryptionKeyHex: ENC_KEY, keyId: "local-key-1" }, clock);
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe("authorization URL (offline access for refresh tokens)", () => {
  it("builds the Google consent URL with the GSC scope and signed state", () => {
    const state = signOAuthState({ workspaceId: WS, userId: USER, expiresAt: clock().getTime() + 600_000 }, HMAC_KEY);
    const url = new URL(buildGoogleAuthUrl({
      clientId: "client-123.apps.googleusercontent.com",
      redirectUri: "https://app.test/connections/google/callback",
      scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
      state,
    }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("access_type")).toBe("offline"); // refresh token support
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("webmasters.readonly");
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("response_type")).toBe("code");
  });
});

describe("state integrity (CSRF)", () => {
  it("round-trips, rejects tampering, rejects expiry", () => {
    const payload = { workspaceId: WS, userId: USER, expiresAt: clock().getTime() + 600_000 };
    const state = signOAuthState(payload, HMAC_KEY);
    expect(verifyOAuthState(state, HMAC_KEY, clock())).toMatchObject({ workspaceId: WS, userId: USER });
    expect(verifyOAuthState(state + "x", HMAC_KEY, clock())).toBeNull();
    expect(verifyOAuthState(state, "other-key", clock())).toBeNull();
    const expired = signOAuthState({ ...payload, expiresAt: clock().getTime() - 1 }, HMAC_KEY);
    expect(verifyOAuthState(expired, HMAC_KEY, clock())).toBeNull();
  });
});

describe("TokenVault (I8 — the ONLY path to provider_tokens)", () => {
  it("stores envelope-encrypted tokens; ciphertext at rest never contains the plaintext", async () => {
    await vault.storeTokens(WS, connectionId, {
      accessToken: "ya29.PLAINTEXT-ACCESS",
      refreshToken: "1//refresh-PLAINTEXT",
      expiresAt: new Date(clock().getTime() + 3600_000),
    });
    const row = await h.admin.query(
      `SELECT enc_access_token, enc_refresh_token, key_id FROM provider_tokens WHERE connection_id = $1`,
      [connectionId],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].key_id).toBe("local-key-1");
    const atRest = Buffer.concat([row.rows[0].enc_access_token, row.rows[0].enc_refresh_token]).toString("latin1");
    expect(atRest).not.toContain("PLAINTEXT");
  });

  it("round-trips through the vault role and audits the access", async () => {
    const tokens = await vault.getTokens(WS, connectionId);
    expect(tokens?.accessToken).toBe("ya29.PLAINTEXT-ACCESS");
    expect(tokens?.refreshToken).toBe("1//refresh-PLAINTEXT");
    const audit = await h.admin.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE event = 'vault.token_access'`,
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("is workspace-scoped: another workspace's scope reads nothing (RLS on the vault role)", async () => {
    const OTHER = randomUUID();
    await seedWorkspace(h.admin, OTHER, "other");
    expect(await vault.getTokens(OTHER, connectionId)).toBeNull();
  });
});

describe("refresh support + connection health (ADR-019 reauth semantics)", () => {
  it("an expired access token is refreshed via the endpoint and re-stored encrypted", async () => {
    await vault.storeTokens(WS, connectionId, {
      accessToken: "ya29.OLD",
      refreshToken: "1//refresh-PLAINTEXT",
      expiresAt: new Date(clock().getTime() - 1000), // already expired
    });
    const endpoint: GoogleTokenEndpoint = {
      exchangeCode: async () => {
        throw new Error("not used");
      },
      refreshToken: async (refreshToken) => {
        expect(refreshToken).toBe("1//refresh-PLAINTEXT");
        return { accessToken: "ya29.FRESH", expiresInSeconds: 3600 };
      },
    };
    const token = await refreshConnectionToken({ pool: h.app, vault, endpoint, workspaceId: WS, connectionId, clock });
    expect(token).toBe("ya29.FRESH");
    expect((await vault.getTokens(WS, connectionId))?.accessToken).toBe("ya29.FRESH");
  });

  it("invalid_grant classifies as auth and the connection flips to expired (reauth prerequisite)", async () => {
    await vault.storeTokens(WS, connectionId, {
      accessToken: "ya29.DEAD",
      refreshToken: "1//revoked",
      expiresAt: new Date(clock().getTime() - 1000),
    });
    const endpoint: GoogleTokenEndpoint = {
      exchangeCode: async () => {
        throw new Error("not used");
      },
      refreshToken: async () => {
        throw new AdapterError("auth", "invalid_grant");
      },
    };
    await expect(
      refreshConnectionToken({ pool: h.app, vault, endpoint, workspaceId: WS, connectionId, clock }),
    ).rejects.toThrow(/invalid_grant/);
    const status = await h.admin.query(`SELECT status FROM connections WHERE id = $1`, [connectionId]);
    expect(status.rows[0].status).toBe("expired");
  });

  it("a still-valid access token is returned without hitting the endpoint", async () => {
    await vault.storeTokens(WS, connectionId, {
      accessToken: "ya29.VALID",
      refreshToken: "1//r",
      expiresAt: new Date(clock().getTime() + 3600_000),
    });
    const endpoint: GoogleTokenEndpoint = {
      exchangeCode: async () => {
        throw new Error("must not be called");
      },
      refreshToken: async () => {
        throw new Error("must not be called");
      },
    };
    await h.admin.query(`UPDATE connections SET status = 'active' WHERE id = $1`, [connectionId]);
    const token = await refreshConnectionToken({ pool: h.app, vault, endpoint, workspaceId: WS, connectionId, clock });
    expect(token).toBe("ya29.VALID");
  });
});
