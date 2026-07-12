/**
 * Magic link (ADR-016): single-use, 10-min expiry, UA-family bound,
 * rate-limited per email (3/h) and per IP. The email leaves through
 * Delivery ONLY (I7) as security_transactional. All responses are generic —
 * no account-existence oracle; refusals are visible in audit_log, not to
 * the caller.
 */
import { createHash, randomBytes } from "node:crypto";

import type pg from "pg";

import type { Delivery } from "@aigos/delivery";

export interface MagicLinkOptions {
  readonly baseUrl: string;
  readonly ttlMinutes?: number;        // ADR-016: 10
  readonly maxPerEmailPerHour?: number; // ADR-016: 3
  readonly maxPerIpPerHour?: number;
}

const sha256 = (value: string): Buffer => createHash("sha256").update(value).digest();

export class MagicLinkService {
  private readonly ttlMinutes: number;
  private readonly maxPerEmailPerHour: number;
  private readonly maxPerIpPerHour: number;

  constructor(
    private readonly pool: pg.Pool,
    private readonly delivery: Delivery,
    private readonly clock: () => Date,
    options: MagicLinkOptions,
  ) {
    this.baseUrl = options.baseUrl;
    this.ttlMinutes = options.ttlMinutes ?? 10;
    this.maxPerEmailPerHour = options.maxPerEmailPerHour ?? 3;
    this.maxPerIpPerHour = options.maxPerIpPerHour ?? 10;
  }

  private readonly baseUrl: string;

  /** Always resolves void — the caller learns nothing about accounts or limits. */
  async request(email: string, uaFamily: string, ip: string): Promise<void> {
    const now = this.clock();
    const hourAgo = new Date(now.getTime() - 3600_000);
    const recent = await this.pool.query(
      `SELECT
         count(*) FILTER (WHERE email = $1)        ::int AS by_email,
         count(*) FILTER (WHERE requested_ip = $2) ::int AS by_ip
       FROM magic_link_tokens WHERE created_at > $3`,
      [email, ip, hourAgo],
    );
    const { by_email, by_ip } = recent.rows[0] as { by_email: number; by_ip: number };
    if (by_email >= this.maxPerEmailPerHour || by_ip >= this.maxPerIpPerHour) {
      await this.pool.query(
        `INSERT INTO audit_log (actor, event, details)
         VALUES ($1, 'magic_link.rate_limited', $2::jsonb)`,
        [email, JSON.stringify({ ip, byEmail: by_email, byIp: by_ip })],
      );
      return; // silent — no oracle
    }

    const token = randomBytes(32).toString("hex");
    await this.pool.query(
      `INSERT INTO magic_link_tokens (email, token_hash, ua_family, requested_ip, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [email, sha256(token), uaFamily, ip, now, new Date(now.getTime() + this.ttlMinutes * 60_000)],
    );
    await this.pool.query(
      `INSERT INTO audit_log (actor, event, details) VALUES ($1, 'magic_link.requested', $2::jsonb)`,
      [email, JSON.stringify({ ip, uaFamily })],
    );
    // Confirmation-tap URL (R19: link scanners must not consume the token).
    await this.delivery.deliver({
      workspaceId: "system",
      type: "security_transactional",
      dedupeKey: `magic:${sha256(token).toString("hex")}`,
      to: email,
      subject: "Your sign-in link",
      body: `Sign-in requested from ${uaFamily} (${ip}). Confirm here: ${this.baseUrl}/auth/confirm?token=${token} — expires in ${this.ttlMinutes} minutes. Not you? Ignore this email.`,
    });
  }

  /** Single-use consume; generic null on any failure (expired, used, wrong UA family, unknown). */
  async consume(token: string, uaFamily: string): Promise<string | null> {
    const now = this.clock();
    const result = await this.pool.query(
      `UPDATE magic_link_tokens SET consumed_at = $3
       WHERE token_hash = $1 AND ua_family = $2 AND consumed_at IS NULL AND expires_at > $3
       RETURNING email`,
      [sha256(token), uaFamily, now],
    );
    if (!result.rowCount) return null;
    const email = (result.rows[0] as { email: string }).email;
    await this.pool.query(
      `INSERT INTO audit_log (actor, event) VALUES ($1, 'magic_link.consumed')`,
      [email],
    );
    return email;
  }
}
