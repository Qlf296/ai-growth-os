/**
 * Server-side sessions (ADR-017): opaque cookie id, 15-min access,
 * rotating refresh (30-day horizon), family invalidation on reuse,
 * instant revocation. No JWTs-as-session.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

import type pg from "pg";

export interface IssuedSession {
  readonly sessionId: string;
  readonly refreshToken: string;
}

export interface CurrentSession {
  readonly sessionId: string;
  readonly userId: string;
}

export interface SessionOptions {
  readonly accessTtlMinutes?: number; // ADR-017: 15
  readonly refreshTtlDays?: number;   // S6 §7: 30
}

const sha256 = (value: string): Buffer => createHash("sha256").update(value).digest();

export class SessionService {
  private readonly accessTtlMinutes: number;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly pool: pg.Pool,
    private readonly clock: () => Date,
    options: SessionOptions = {},
  ) {
    this.accessTtlMinutes = options.accessTtlMinutes ?? 15;
    this.refreshTtlDays = options.refreshTtlDays ?? 30;
  }

  async issue(userId: string, uaFamily: string, ip: string): Promise<IssuedSession> {
    return this.insert(userId, uaFamily, ip, randomUUID());
  }

  private async insert(
    userId: string,
    uaFamily: string,
    ip: string | null,
    family: string,
  ): Promise<IssuedSession> {
    const now = this.clock();
    const refreshToken = randomBytes(32).toString("hex");
    const result = await this.pool.query(
      `INSERT INTO sessions (user_id, refresh_family, refresh_hash, ua_family, ip_created, expires_at, refresh_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        userId,
        family,
        sha256(refreshToken),
        uaFamily,
        ip,
        new Date(now.getTime() + this.accessTtlMinutes * 60_000),
        new Date(now.getTime() + this.refreshTtlDays * 86_400_000),
      ],
    );
    return { sessionId: (result.rows[0] as { id: string }).id, refreshToken };
  }

  async validate(sessionId: string): Promise<CurrentSession | null> {
    const result = await this.pool.query(
      `SELECT id, user_id FROM sessions
       WHERE id = $1 AND revoked_at IS NULL AND rotated_at IS NULL AND expires_at > $2`,
      [sessionId, this.clock()],
    );
    if (!result.rowCount) return null;
    const row = result.rows[0] as { id: string; user_id: string };
    return { sessionId: row.id, userId: row.user_id };
  }

  /**
   * Rotate: the presented refresh token is retired and a new session row of
   * the same family is issued. Presenting an ALREADY-ROTATED token is reuse
   * (stolen-refresh defense) → the whole family is revoked.
   */
  async refresh(refreshToken: string, uaFamily: string): Promise<IssuedSession | null> {
    const now = this.clock();
    const hash = sha256(refreshToken);
    const found = await this.pool.query(
      `SELECT id, user_id, refresh_family, rotated_at, revoked_at, refresh_expires_at, ua_family
       FROM sessions WHERE refresh_hash = $1`,
      [hash],
    );
    if (!found.rowCount) return null;
    const row = found.rows[0] as {
      id: string; user_id: string; refresh_family: string;
      rotated_at: Date | null; revoked_at: Date | null; refresh_expires_at: Date; ua_family: string;
    };

    if (row.rotated_at !== null) {
      // reuse detected → family-invalidate (ADR-017)
      await this.pool.query(
        `UPDATE sessions SET revoked_at = $2 WHERE refresh_family = $1 AND revoked_at IS NULL`,
        [row.refresh_family, now],
      );
      await this.pool.query(
        `INSERT INTO audit_log (actor, event, details) VALUES ($1, 'session.family_revoked', $2::jsonb)`,
        [row.user_id, JSON.stringify({ family: row.refresh_family, cause: "refresh_reuse" })],
      );
      return null;
    }
    if (row.revoked_at !== null || row.refresh_expires_at <= now || row.ua_family !== uaFamily) {
      return null;
    }

    await this.pool.query(`UPDATE sessions SET rotated_at = $2 WHERE id = $1`, [row.id, now]);
    return this.insert(row.user_id, uaFamily, null, row.refresh_family);
  }

  /** Instant revocation is a query (ADR-017). */
  async revoke(sessionId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING user_id`,
      [sessionId, this.clock()],
    );
    if (result.rowCount) {
      await this.pool.query(
        `INSERT INTO audit_log (actor, event, details) VALUES ($1, 'session.revoked', $2::jsonb)`,
        [(result.rows[0] as { user_id: string }).user_id, JSON.stringify({ sessionId })],
      );
    }
  }

  /** Global sign-out (email change, user request — S6 §2). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId, this.clock()],
    );
  }
}
