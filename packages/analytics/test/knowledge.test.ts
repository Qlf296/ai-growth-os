/** STEP 9.4 — knowledge promotion (ADR-012): promote only with grade-A + stability + shadow approval; rollback otherwise. */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withWorkspace } from "@aigos/database";

import { evaluatePromotion, promoteKnowledge } from "../src/index.js";
import { startHarness, seedWorkspace, type Harness } from "../../database/test/harness.js";

let h: Harness;
const WS = randomUUID();
const OTHER = randomUUID();
const KEY = "detector:seo.ctr_gap";

beforeAll(async () => { h = await startHarness(); await seedWorkspace(h.admin, WS, "ws"); await seedWorkspace(h.admin, OTHER, "o"); }, 120_000);
afterAll(async () => { await h.stop(); });

describe("evaluatePromotion (ADR-012 hard criteria)", () => {
  it("validated only with enough samples + grade-A + stable + shadow approved", () => {
    expect(evaluatePromotion({ samples: 12, gradeACount: 3, stable: true, shadowApproved: true })).toBe("validated");
    expect(evaluatePromotion({ samples: 12, gradeACount: 3, stable: true, shadowApproved: false })).toBe("observation"); // no shadow
    expect(evaluatePromotion({ samples: 12, gradeACount: 1, stable: true, shadowApproved: true })).toBe("observation"); // too few grade-A
    expect(evaluatePromotion({ samples: 12, gradeACount: 3, stable: false, shadowApproved: true })).toBe("observation"); // not stable
    expect(evaluatePromotion({ samples: 6, gradeACount: 5, stable: true, shadowApproved: true })).toBe("observation"); // too few samples
    expect(evaluatePromotion({ samples: 2, gradeACount: 0, stable: false, shadowApproved: false })).toBe("hypothesis");
  });
});

describe("promoteKnowledge (single writer, audited)", () => {
  it("promotes to validated and records the KB entry + audit", async () => {
    const ev = [randomUUID()];
    const r = await promoteKnowledge(h.app, WS, KEY, { samples: 12, gradeACount: 4, stable: true, shadowApproved: true }, ev);
    expect(r.level).toBe("validated");
    const row = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT epistemic_level, grade_a_count, evidence_ids FROM kb_entries WHERE key = $1`, [KEY]));
    expect(row.rows[0].epistemic_level).toBe("validated");
    expect(row.rows[0].evidence_ids).toEqual(ev); // I4
    const audit = await h.admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE event = 'kb.promotion' AND workspace_id = $1`, [WS]);
    expect(audit.rows[0].n).toBe(1);
  });

  it("rollback: losing stability demotes a validated entry to observation", async () => {
    await promoteKnowledge(h.app, WS, KEY, { samples: 12, gradeACount: 4, stable: false, shadowApproved: true }, []);
    const row = await withWorkspace(h.app, WS, (tx) => tx.query(`SELECT epistemic_level FROM kb_entries WHERE key = $1`, [KEY]));
    expect(row.rows[0].epistemic_level).toBe("observation");
  });

  it("RLS: another workspace has no KB entries", async () => {
    expect((await withWorkspace(h.app, OTHER, (tx) => tx.query(`SELECT * FROM kb_entries`))).rowCount).toBe(0);
  });
});
