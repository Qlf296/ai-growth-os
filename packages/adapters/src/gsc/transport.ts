/**
 * GSC transport port. The real HTTP transport (OAuth-authenticated) arrives
 * with the OAuth step; fixtures are the sandbox (ADR-021 §4 — GSC has no
 * reliable provider sandbox).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface GscSearchAnalyticsRequest {
  readonly siteUrl: string;
  readonly startDate: string; // YYYY-MM-DD
  readonly endDate: string;
  readonly dimensions: readonly ["date", "query", "page"];
}

export interface GscTransport {
  /** Verified-properties list (Search Console `sites.list`). */
  listSites(): Promise<unknown>;
  querySearchAnalytics(request: GscSearchAnalyticsRequest): Promise<unknown>;
}

/** Replays recorded, sanitized real responses (golden files). */
export class FixtureGscTransport implements GscTransport {
  constructor(private readonly fixturesDir: string) {}

  private fixture(name: string): Promise<unknown> {
    return Promise.resolve(JSON.parse(readFileSync(join(this.fixturesDir, name), "utf8")));
  }

  listSites(): Promise<unknown> {
    return this.fixture("sites.list.json");
  }

  querySearchAnalytics(_request: GscSearchAnalyticsRequest): Promise<unknown> {
    return this.fixture("search-analytics.daily.json");
  }
}

/**
 * Authenticated production transport — plain fetch, no SDK. The access token
 * comes from the vault via refreshConnectionToken (I8: token stays in-process,
 * never logged). Exercised against real Google only, never in CI.
 */
export class HttpGscTransport implements GscTransport {
  constructor(private readonly accessToken: string) {}

  private async call(url: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(url, {
      ...init,
      headers: { authorization: `Bearer ${this.accessToken}`, "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      const { AdapterError } = await import("../types.js");
      const kind = res.status === 401 || res.status === 403 ? "auth" : res.status === 429 ? "quota" : "transient";
      throw new AdapterError(kind, `gsc api: HTTP ${res.status}`);
    }
    return res.json();
  }

  listSites(): Promise<unknown> {
    return this.call("https://www.googleapis.com/webmasters/v3/sites");
  }

  querySearchAnalytics(request: GscSearchAnalyticsRequest): Promise<unknown> {
    return this.call(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(request.siteUrl)}/searchAnalytics/query`,
      { method: "POST", body: JSON.stringify({ startDate: request.startDate, endDate: request.endDate, dimensions: request.dimensions }) },
    );
  }
}
