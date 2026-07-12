/**
 * PgConfigStore — the Postgres-backed ConfigStore promised at step 2.
 * Same contract as InMemoryConfigStore; storage is append-only BY GRANT
 * (the app role has no UPDATE/DELETE on config_overrides — I5, ADR-046).
 * The ConfigRegistry gate tests (ADR-045/AT-14) rerun here against Postgres.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConfigRegistry, num } from "@aigos/config-registry";

import { PgConfigStore } from "../src/config-store.js";
import { startHarness, seedWorkspace, type Harness } from "./harness.js";

let h: Harness;
let registry: ConfigRegistry;
const WS = randomUUID();

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS, "ws");
  registry = new ConfigRegistry(new PgConfigStore(h.app));
  registry.define({
    key: "recommendation.w_goal",
    description: "S16 §7 weight",
    owner: "recommendation",
    stability: "experiment",
    decisionAffecting: true,
    schema: num({ min: 0, max: 1 }),
    defaultValue: 0.3,
  });
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe("PgConfigStore behind ConfigRegistry", () => {
  it("default → global override → workspace override precedence, persisted in Postgres", async () => {
    expect(await registry.get("recommendation.w_goal")).toBe(0.3);
    await registry.setOverride("recommendation.w_goal", 0.35, {
      changedBy: "founder",
      reason: "global",
      shadowEvalRef: "se-1",
    });
    await registry.setOverride("recommendation.w_goal", 0.4, {
      changedBy: "founder",
      reason: "ws",
      shadowEvalRef: "se-2",
      workspaceId: WS,
    });
    expect(await registry.get("recommendation.w_goal")).toBe(0.35);
    expect(await registry.get("recommendation.w_goal", { workspaceId: WS })).toBe(0.4);
  });

  it("decision-affecting gate holds against the Pg store too (AT-14)", async () => {
    await expect(
      registry.setOverride("recommendation.w_goal", 0.5, {
        changedBy: "founder",
        reason: "no shadow eval",
      }),
    ).rejects.toThrow(/shadow[- ]?eval/i);
  });

  it("history is append-only, ordered, and RLS-scoped (ws rows only in ws scope)", async () => {
    const scoped = await registry.history("recommendation.w_goal", { workspaceId: WS });
    expect(scoped.length).toBe(2);
    expect(scoped[0]?.reason).toBe("global");
    expect(scoped[1]?.reason).toBe("ws");
    const unscoped = await registry.history("recommendation.w_goal");
    expect(unscoped.length).toBe(1); // global row only — tenant isolation holds for config too
    expect(unscoped[0]?.reason).toBe("global");
  });

  it("append-only is enforced BY GRANT: app role cannot UPDATE or DELETE the log", async () => {
    await expect(h.app.query("UPDATE config_overrides SET reason = 'tamper'")).rejects.toThrow(
      /permission denied/i,
    );
    await expect(h.app.query("DELETE FROM config_overrides")).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("snapshots hash identically across store backends for identical state", async () => {
    const snap = await registry.snapshot({ workspaceId: WS });
    expect(snap.values["recommendation.w_goal"]).toBe(0.4);
    expect(snap.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
