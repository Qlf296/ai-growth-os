/**
 * TokenVault — the ONLY code path to provider_tokens (I8), running on the
 * dedicated vault role (zero app-role access, enforced by GRANT + tested).
 * Envelope encryption: AES-256-GCM, key custody outside the DB (key_id
 * points at the key; rotation = new key_id). Every read is audited.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type pg from "pg";

import { withWorkspace } from "./tenancy.js";

export interface VaultKey {
  readonly encryptionKeyHex: string; // 32 bytes hex — from the secret store, never the DB
  readonly keyId: string;
}

export interface StoredTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: Date | null;
}

export class TokenVault {
  private readonly key: Buffer;

  constructor(
    private readonly vaultPool: pg.Pool,
    private readonly keyConfig: VaultKey,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.key = Buffer.from(keyConfig.encryptionKeyHex, "hex");
    if (this.key.length !== 32) throw new Error("vault encryption key must be 32 bytes hex");
  }

  private encrypt(plaintext: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  private decrypt(blob: Buffer): string {
    const decipher = createDecipheriv("aes-256-gcm", this.key, blob.subarray(0, 12));
    decipher.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString("utf8");
  }

  async storeTokens(
    workspaceId: string,
    connectionId: string,
    tokens: { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null },
  ): Promise<void> {
    const encAccess = this.encrypt(tokens.accessToken);
    const encRefresh = tokens.refreshToken ? this.encrypt(tokens.refreshToken) : null;
    await withWorkspace(this.vaultPool, workspaceId, (tx) =>
      tx.query(
        `INSERT INTO provider_tokens (connection_id, enc_access_token, enc_refresh_token, key_id, expires_at, rotated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (connection_id) DO UPDATE SET
           enc_access_token = EXCLUDED.enc_access_token,
           enc_refresh_token = COALESCE(EXCLUDED.enc_refresh_token, provider_tokens.enc_refresh_token),
           key_id = EXCLUDED.key_id,
           expires_at = EXCLUDED.expires_at,
           rotated_at = EXCLUDED.rotated_at`,
        [connectionId, encAccess, encRefresh, this.keyConfig.keyId, tokens.expiresAt ?? null, this.clock()],
      ),
    );
  }

  /** Audited read (S3 §3). Returns null when out of scope or absent — never throws tenant info. */
  async getTokens(workspaceId: string, connectionId: string): Promise<StoredTokens | null> {
    return withWorkspace(this.vaultPool, workspaceId, async (tx) => {
      const r = await tx.query(
        `SELECT enc_access_token, enc_refresh_token, expires_at FROM provider_tokens WHERE connection_id = $1`,
        [connectionId],
      );
      if (!r.rowCount) return null;
      await tx.query(
        `INSERT INTO audit_log (workspace_id, actor, event, details) VALUES ($1, 'vault', 'vault.token_access', $2::jsonb)`,
        [workspaceId, JSON.stringify({ connectionId })],
      );
      const row = r.rows[0] as { enc_access_token: Buffer; enc_refresh_token: Buffer | null; expires_at: Date | null };
      return {
        accessToken: this.decrypt(row.enc_access_token),
        refreshToken: row.enc_refresh_token ? this.decrypt(row.enc_refresh_token) : null,
        expiresAt: row.expires_at,
      };
    });
  }

  async updateAccessToken(workspaceId: string, connectionId: string, accessToken: string, expiresAt: Date): Promise<void> {
    const enc = this.encrypt(accessToken);
    await withWorkspace(this.vaultPool, workspaceId, (tx) =>
      tx.query(
        `UPDATE provider_tokens SET enc_access_token = $2, expires_at = $3, rotated_at = $4 WHERE connection_id = $1`,
        [connectionId, enc, expiresAt, this.clock()],
      ),
    );
  }
}
