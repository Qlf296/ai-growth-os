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
  querySearchAnalytics(request: GscSearchAnalyticsRequest): Promise<unknown>;
}

/** Replays recorded, sanitized real responses (golden files). */
export class FixtureGscTransport implements GscTransport {
  constructor(private readonly fixturesDir: string) {}

  querySearchAnalytics(_request: GscSearchAnalyticsRequest): Promise<unknown> {
    return Promise.resolve(
      JSON.parse(readFileSync(join(this.fixturesDir, "search-analytics.daily.json"), "utf8")),
    );
  }
}
