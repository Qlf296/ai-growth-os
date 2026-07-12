export { createGscAdapter, GSC_CAPABILITIES, GSC_OAUTH_SCOPES } from "./adapter.js";
export { FixtureGscTransport, HttpGscTransport } from "./transport.js";
export type { GscSearchAnalyticsRequest, GscTransport } from "./transport.js";
export { ingestSearchAnalytics, GscValidationError } from "./ingest.js";
export type { BeforeCall, IngestParams, IngestResult } from "./ingest.js";
export { validateGscResponse, validateSitesResponse, toSignalDrafts, GSC_SIGNAL_TYPE, GSC_NORMALIZER_VERSION } from "./normalize.js";
export type { GscRow, GscSite } from "./normalize.js";
