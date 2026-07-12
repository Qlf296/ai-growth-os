export { createGscAdapter, GSC_CAPABILITIES, GSC_OAUTH_SCOPES } from "./adapter.js";
export { FixtureGscTransport } from "./transport.js";
export type { GscSearchAnalyticsRequest, GscTransport } from "./transport.js";
export { ingestSearchAnalytics, GscValidationError } from "./ingest.js";
export type { IngestParams, IngestResult } from "./ingest.js";
export { validateGscResponse, toSignalDrafts, GSC_SIGNAL_TYPE, GSC_NORMALIZER_VERSION } from "./normalize.js";
export type { GscRow } from "./normalize.js";
