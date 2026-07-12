/** @aigos/config-registry — ADR-046. Public interface of the module (S2 §2). */
export { ConfigRegistry } from "./registry.js";
export { InMemoryConfigStore } from "./store.js";
export { bool, int, num, oneOf, str } from "./schema.js";
export type {
  ChangeContext,
  ConfigChangeRecord,
  ConfigKeyDefinition,
  ConfigSchema,
  ConfigSnapshot,
  ConfigStore,
  ReadScope,
  SchemaResult,
  Stability,
} from "./types.js";
