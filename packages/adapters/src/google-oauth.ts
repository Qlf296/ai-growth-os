/**
 * Google OAuth for provider connections (ADR-019: workspace-owned,
 * authorized_by; I8: tokens go to the vault and nowhere else).
 * The token endpoint is a port: FetchGoogleTokenEndpoint talks to Google in
 * production; tests use fakes (no network in CI).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import type pg from "pg";
import type { TokenVault } from "@aigos/database";

import { applyConnectionStatus } from "./lifecycle.js";
import { classifyError } from "./capabilities.js";
import { AdapterError } from "./types.js";

// ── Authorization URL ─────────────────────────────────────────────────────────
export interface AuthUrlParams {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly state: string;
}

export function buildGoogleAuthUrl(params: AuthUrlParams): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", params.scopes.join(" "));
  url.searchParams.set("access_type", "offline"); // refresh token (I8 lifecycle)
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", params.state);
  return url.toString();
}

// ── Signed state (CSRF) ──────────────────────────────────────────────────────
export interface OAuthStatePayload {
  readonly workspaceId: string;
  readonly userId: string;
  readonly expiresAt: number; // epoch ms
  /** GSC property the user chose to connect; drives first-ingestion scheduling. */
  readonly site?: string;
}

const b64url = (buf: Buffer): string => buf.toString("base64url");

export function signOAuthState(payload: OAuthStatePayload, hmacKey: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const mac = createHmac("sha256", hmacKey).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyOAuthState(state: string, hmacKey: string, now: Date): OAuthStatePayload | null {
  const [body, mac] = state.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", hmacKey).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as OAuthStatePayload;
    if (typeof payload.expiresAt !== "number" || payload.expiresAt <= now.getTime()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Token endpoint port ──────────────────────────────────────────────────────
export interface ExchangedTokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresInSeconds: number;
  readonly grantedScopes?: readonly string[];
}

export interface GoogleTokenEndpoint {
  exchangeCode(code: string): Promise<ExchangedTokens>;
  refreshToken(refreshToken: string): Promise<{ accessToken: string; expiresInSeconds: number }>;
}

/** Production transport — plain fetch, no SDK. Exercised against real Google only (not in CI). */
export class FetchGoogleTokenEndpoint implements GoogleTokenEndpoint {
  constructor(
    private readonly config: { clientId: string; clientSecret: string; redirectUri: string },
  ) {}

  private async post(body: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
    const payload = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const code = String(payload.error ?? res.status);
      throw new AdapterError(code === "invalid_grant" ? "auth" : "transient", `google token endpoint: ${code}`);
    }
    return payload;
  }

  async exchangeCode(code: string): Promise<ExchangedTokens> {
    const p = await this.post({
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      grant_type: "authorization_code",
    });
    const base = { accessToken: p.access_token as string, expiresInSeconds: p.expires_in as number };
    return {
      ...base,
      ...(typeof p.refresh_token === "string" ? { refreshToken: p.refresh_token } : {}),
      ...(typeof p.scope === "string" ? { grantedScopes: p.scope.split(" ") } : {}),
    };
  }

  async refreshToken(refreshToken: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
    const p = await this.post({
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "refresh_token",
    });
    return { accessToken: p.access_token as string, expiresInSeconds: p.expires_in as number };
  }
}

// ── Refresh with connection-health coupling (ADR-019 reauth semantics) ───────
const EXPIRY_MARGIN_MS = 60_000;

export interface RefreshParams {
  readonly pool: pg.Pool;
  readonly vault: TokenVault;
  readonly endpoint: GoogleTokenEndpoint;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly clock: () => Date;
}

/** Returns a valid access token, refreshing (and re-vaulting) if needed. auth failure ⇒ connection expired. */
export async function refreshConnectionToken(params: RefreshParams): Promise<string> {
  const tokens = await params.vault.getTokens(params.workspaceId, params.connectionId);
  if (!tokens) throw new AdapterError("auth", "no tokens in vault for this connection");
  const now = params.clock();
  if (tokens.expiresAt && tokens.expiresAt.getTime() > now.getTime() + EXPIRY_MARGIN_MS) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) throw new AdapterError("auth", "access expired and no refresh token");
  try {
    const fresh = await params.endpoint.refreshToken(tokens.refreshToken);
    const expiresAt = new Date(now.getTime() + fresh.expiresInSeconds * 1000);
    await params.vault.updateAccessToken(params.workspaceId, params.connectionId, fresh.accessToken, expiresAt);
    return fresh.accessToken;
  } catch (error) {
    const classified = classifyError(error);
    if (classified.kind === "auth") {
      await applyConnectionStatus(params.pool, params.workspaceId, params.connectionId, "expired").catch(() => {});
    }
    throw classified;
  }
}
