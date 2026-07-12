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
