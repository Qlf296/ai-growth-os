/**
 * @aigos/identity — passwordless auth + server sessions (ADR-016/017).
 * Independent by design: depends only on pg (its own tables) and Delivery
 * (I7 — the only way any email leaves). Future providers (Google OAuth,
 * ADR-016) plug in beside MagicLinkService and reuse SessionService as-is:
 * any provider's job is only to produce a verified email.
 */
export { MagicLinkService } from "./magic-link.js";
export type { MagicLinkOptions } from "./magic-link.js";
export { SessionService } from "./sessions.js";
export type { CurrentSession, IssuedSession, SessionOptions } from "./sessions.js";
