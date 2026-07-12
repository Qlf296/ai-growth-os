/** GSC adapter (S7 §1.1 dossier as data) built on the ADR-021 framework. */
import { int } from "@aigos/config-registry";

import type { Adapter, CapabilityManifest } from "../types.js";
import type { GscTransport } from "./transport.js";

export const GSC_CAPABILITIES: CapabilityManifest = {
  read_search_analytics: true,
  publish: false,          // GSC is read-only by nature
  backfill_months: "16",   // S7 §1.1
};

export const GSC_OAUTH_SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"] as const;

export function createGscAdapter(transport: GscTransport): Adapter {
  return {
    descriptor: {
      provider: "gsc",
      apiVersion: "searchconsole_v1",
      capabilities: GSC_CAPABILITIES,
      deprecationCheckJobFamily: "gsc.deprecation_check",
      configKeys: [
        {
          key: "adapters.gsc.data_lag_days",
          description: "GSC data lags ~2 days — never promise today's SEO (S7 §1.1)",
          owner: "ingestion",
          stability: "stable",
          decisionAffecting: false,
          schema: int({ min: 0, max: 14 }),
          defaultValue: 2,
        },
        {
          key: "adapters.gsc.backfill_chunk_days",
          description: "Backfill jobs chunk by date range with backoff (S7 §1.1)",
          owner: "ingestion",
          stability: "experiment",
          decisionAffecting: false,
          schema: int({ min: 1, max: 90 }),
          defaultValue: 30,
        },
      ],
    },
    async healthCheck() {
      // Cheap liveness probe: a 1-day, 1-row query. Errors classify upstream (ADR-021 §6).
      await transport.querySearchAnalytics({
        siteUrl: "healthcheck",
        startDate: "2026-01-01",
        endDate: "2026-01-01",
        dimensions: ["date", "query", "page"],
      });
    },
  };
}
