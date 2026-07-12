/** SEO tier-0 detectors (STEP 3.3). Consume normalized signals only — never providers. */
import type { Detector, Finding, PageAggregate } from "./types.js";

const round = (n: number, d = 4): number => Math.round(n * 10 ** d) / 10 ** d;

/** Simple, honest position→CTR expectation curve (labeled observation, wide). */
function expectedCtr(position: number): number {
  if (position <= 1) return 0.28;
  if (position <= 2) return 0.15;
  if (position <= 3) return 0.10;
  if (position <= 5) return 0.06;
  if (position <= 10) return 0.03;
  return 0.01;
}

export const strikingDistance: Detector = {
  name: "seo.striking_distance",
  category: "seo",
  detect({ recent, thresholds }): Finding[] {
    const min = thresholds.position_min ?? 5;
    const max = thresholds.position_max ?? 20;
    const floor = thresholds.impressions_floor ?? 100;
    return recent
      .filter((p) => p.position >= min && p.position <= max && p.impressions >= floor)
      .map((p) => ({
        entity: p.page,
        severity: "info" as const,
        confidence: p.impressions >= floor * 5 ? ("high" as const) : ("medium" as const),
        explanation: `Ranks at position ${round(p.position, 1)} with ${p.impressions} impressions — a push could move it into clicks range.`,
        data: { position: round(p.position, 1), impressions: p.impressions, clicks: p.clicks },
        evidence: { metric: "position", value: round(p.position, 1), impressions: p.impressions, clicks: p.clicks, window: "recent" },
      }));
  },
};

export const ctrGap: Detector = {
  name: "seo.ctr_gap",
  category: "seo",
  detect({ recent, thresholds }): Finding[] {
    const floor = thresholds.impressions_floor ?? 100;
    const minGap = thresholds.min_gap ?? 0.3; // fraction below expectation
    const out: Finding[] = [];
    for (const p of recent) {
      if (p.impressions < floor) continue;
      const expected = expectedCtr(p.position);
      if (p.ctr < expected * (1 - minGap)) {
        out.push({
          entity: p.page,
          severity: "low",
          confidence: "medium",
          explanation: `CTR ${round(p.ctr)} is below the ~${expected} expected at position ${round(p.position, 1)}.`,
          data: { ctr: round(p.ctr), expectedCtr: expected, position: round(p.position, 1), impressions: p.impressions },
          evidence: { metric: "ctr", value: round(p.ctr), expectedCtr: expected, position: round(p.position, 1), impressions: p.impressions, window: "recent" },
        });
      }
    }
    return out;
  },
};

function dropDetector(name: string, field: "impressions" | "clicks", priorFloorKey: string): Detector {
  return {
    name,
    category: "seo",
    detect({ recent, prior, thresholds }): Finding[] {
      const priorFloor = thresholds[priorFloorKey] ?? 100;
      const dropPct = thresholds.drop_pct ?? 0.3;
      const priorBy = new Map(prior.map((p) => [p.page, p]));
      const out: Finding[] = [];
      for (const r of recent) {
        const p = priorBy.get(r.page);
        if (!p || p[field] < priorFloor) continue;
        const drop = (p[field] - r[field]) / p[field];
        if (drop >= dropPct) {
          out.push({
            entity: r.page,
            severity: "medium",
            confidence: p[field] >= priorFloor * 3 ? "high" : "medium",
            explanation: `${field} fell ${Math.round(drop * 100)}% (${p[field]} → ${r[field]}) versus the prior window.`,
            data: { field, prior: p[field], recent: r[field], dropPct: round(drop) },
            evidence: { metric: field, prior: p[field], recent: r[field], dropPct: round(drop), window: "recent_vs_prior" },
          });
        }
      }
      return out;
    },
  };
}

export const impressionDrop = dropDetector("seo.impression_drop", "impressions", "min_prior_impressions");
export const clickDrop = dropDetector("seo.click_drop", "clicks", "min_prior_clicks");

export const ALL_DETECTORS: readonly Detector[] = [strikingDistance, ctrGap, impressionDrop, clickDrop];

/** Aggregate daily query×page rows into per-page metrics over a set of rows. */
export function aggregatePages(rows: readonly { data: Record<string, unknown> }[]): PageAggregate[] {
  const acc = new Map<string, { clicks: number; impressions: number; posWeighted: number }>();
  for (const row of rows) {
    const d = row.data as { page?: string; clicks?: number; impressions?: number; position?: number };
    if (typeof d.page !== "string") continue;
    const clicks = Number(d.clicks ?? 0);
    const impressions = Number(d.impressions ?? 0);
    const position = Number(d.position ?? 0);
    const cur = acc.get(d.page) ?? { clicks: 0, impressions: 0, posWeighted: 0 };
    cur.clicks += clicks;
    cur.impressions += impressions;
    cur.posWeighted += position * impressions;
    acc.set(d.page, cur);
  }
  return [...acc.entries()]
    .map(([page, a]) => ({
      page,
      clicks: a.clicks,
      impressions: a.impressions,
      ctr: a.impressions > 0 ? a.clicks / a.impressions : 0,
      position: a.impressions > 0 ? a.posWeighted / a.impressions : 0,
    }))
    .sort((x, y) => (x.page < y.page ? -1 : 1)); // deterministic order
}
