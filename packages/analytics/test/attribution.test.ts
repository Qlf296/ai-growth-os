/** STEP 9.6 — UTM-independent attribution (ADR-020): UTM / non-UTM / GSC-only / mixed; never solely UTM. */
import { describe, expect, it } from "vitest";

import { gradeOutcome, resolveAttribution } from "../src/index.js";

describe("resolveAttribution", () => {
  it("UTM only → utmKeyed, page-scoped, source utm; value from UTM", () => {
    const r = resolveAttribution({ utm: { value: 42 } });
    expect(r.source).toBe("utm");
    expect(r.attribution).toMatchObject({ pageScoped: true, utmKeyed: true, confounders: 0 });
    expect(r.observedValue).toBe(42);
    expect(gradeOutcome(r.attribution, "met")).toBe("A"); // UTM page-scoped, no confounders
  });

  it("GSC only → measurable WITHOUT UTM (independence); source gsc, grade B", () => {
    const r = resolveAttribution({ gsc: { value: 0.03 } });
    expect(r.source).toBe("gsc");
    expect(r.observedValue).toBe(0.03);
    expect(r.attribution.utmKeyed).toBe(false);
    expect(r.attribution.pageScoped).toBe(true); // measurement does not depend on UTM
    expect(gradeOutcome(r.attribution, "met")).toBe("B");
  });

  it("non-UTM referral → page-scoped, not utm-keyed", () => {
    const r = resolveAttribution({ referral: { value: 10 } });
    expect(r.source).toBe("referral");
    expect(r.attribution.utmKeyed).toBe(false);
    expect(r.observedValue).toBe(10);
  });

  it("mixed (UTM + GSC) → source mixed, utm-keyed, prefers the UTM value", () => {
    const r = resolveAttribution({ utm: { value: 42 }, gsc: { value: 0.03 } });
    expect(r.source).toBe("mixed");
    expect(r.attribution.utmKeyed).toBe(true);
    expect(r.observedValue).toBe(42);
  });

  it("no sources → not measurable (source none, grade F) — but this only happens with NO data, never merely missing UTM", () => {
    const none = resolveAttribution({});
    expect(none.source).toBe("none");
    expect(none.observedValue).toBeNull();
    expect(gradeOutcome(none.attribution, "met")).toBe("F");
    // key invariant: missing UTM alone still measures via GSC
    expect(resolveAttribution({ gsc: { value: 0.02 } }).observedValue).not.toBeNull();
  });

  it("confounders drop UTM grade to B+ and GSC to C", () => {
    expect(gradeOutcome(resolveAttribution({ utm: { value: 1 }, confounders: 1 }).attribution, "met")).toBe("B+");
    expect(gradeOutcome(resolveAttribution({ gsc: { value: 1 }, confounders: 1 }).attribution, "met")).toBe("C");
  });
});
