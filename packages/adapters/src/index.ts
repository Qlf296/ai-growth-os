/** @aigos/adapters — adapter framework (ADR-021/007/019). No providers yet. */
export { AdapterRegistry } from "./registry.js";
export { classifyError, requireCapability } from "./capabilities.js";
export { applyConnectionStatus, registerAdapterConfig, runHealthCheck } from "./lifecycle.js";
export { AdapterError } from "./types.js";
export type {
  Adapter,
  AdapterDescriptor,
  AdapterErrorKind,
  CapabilityManifest,
  HealthResult,
} from "./types.js";
export * from "./gsc/index.js";
export { InMemoryRateCounter, RedisRateCounter, QuotaGuard } from "./quota.js";
export type { QuotaLimits, RateCounter, RedisCounterLike } from "./quota.js";
export {
  buildGoogleAuthUrl,
  signOAuthState,
  verifyOAuthState,
  refreshConnectionToken,
  FetchGoogleTokenEndpoint,
} from "./google-oauth.js";
export type {
  AuthUrlParams,
  ExchangedTokens,
  GoogleTokenEndpoint,
  OAuthStatePayload,
  RefreshParams,
} from "./google-oauth.js";
export { checkConnectionHealth, healthForErrorKind } from "./health.js";
export type { HealthCheckParams, HealthCheckResult } from "./health.js";
