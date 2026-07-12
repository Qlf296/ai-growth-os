/**
 * Measurement independence (STEP 9.6; ADR-020). Resolves an attribution from
 * whatever sources are available — UTM referral, GSC page-scoped metric, or
 * generic referral — and selects the observed value. The closed loop works
 * even with NO platform API: GSC alone yields a measurable, page-scoped outcome.
 * Measurement therefore never depends *solely* on UTM.
 */
import type { Attribution } from "./grade.js";

export interface AttributionSources {
  /** UTM-keyed referral result (ADR-020) — clicks tied to the action's content id. */
  utm?: { value: number } | null;
  /** GSC page-scoped metric on the exact edited page. */
  gsc?: { value: number } | null;
  /** Generic referral (GA4/ForgCV) not UTM-keyed. */
  referral?: { value: number } | null;
  /** Co-occurring events in scope/window (event register, ADR-024). */
  confounders?: number;
}

export type AttributionSource = "utm" | "gsc" | "referral" | "mixed" | "none";

export interface ResolvedAttribution {
  attribution: Attribution;
  observedValue: number | null;
  source: AttributionSource;
}

export function resolveAttribution(sources: AttributionSources): ResolvedAttribution {
  const hasUtm = sources.utm != null;
  const hasGsc = sources.gsc != null;
  const hasReferral = sources.referral != null;
  const confounders = sources.confounders ?? 0;

  // A page/action-scoped signal exists if any direct source is present.
  const pageScoped = hasUtm || hasGsc || hasReferral;

  // Prefer the most direct, isolable value: UTM (action-keyed) > GSC (page-scoped) > referral.
  const observedValue = hasUtm ? sources.utm!.value : hasGsc ? sources.gsc!.value : hasReferral ? sources.referral!.value : null;

  const present = [hasUtm, hasGsc || hasReferral].filter(Boolean).length;
  const source: AttributionSource = !pageScoped ? "none" : hasUtm && (hasGsc || hasReferral) ? "mixed" : hasUtm ? "utm" : hasGsc ? "gsc" : "referral";
  void present;

  return {
    attribution: { pageScoped, utmKeyed: hasUtm, confounders },
    observedValue,
    source,
  };
}
