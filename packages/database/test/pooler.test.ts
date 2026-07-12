/**
 * Pooler-safety (BUILD_RULES step 3 NOTE): with Supabase transaction-mode
 * pooling, one physical connection serves many logical clients. Only
 * SET LOCAL (transaction-scoped) is safe. These tests reuse ONE physical
 * connection across sequential transactions — the pooler's exact hazard.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withWorkspaceOnClient } from "../src/tenancy.js";
import { startHarness, seedWorkspace, type Harness } from "./harness.js";

let h: Harness;
const WS_A = randomUUID();
const WS_B = randomUUID();

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS_A, "A");
  await seedWorkspace(h.admin, WS_B, "B");
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe("SET LOCAL is transaction-scoped (pooler-safe)", () => {
  it("workspace context does NOT survive COMMIT on the same physical connection", async () => {
    const client = await h.app.connect();
    try {
      await withWorkspaceOnClient(client, WS_A, async (tx) => {
        const r = await tx.query("SELECT current_setting('app.workspace_id', true) AS ws");
        expect(r.rows[0].ws).toBe(WS_A);
      });
      // same physical connection, after COMMIT: setting must be gone
      const after = await client.query("SELECT current_setting('app.workspace_id', true) AS ws");
      expect(after.rows[0].ws ?? "").toBe("");
      const rows = await client.query("SELECT count(*)::int AS n FROM workspaces");
      expect(rows.rows[0].n).toBe(0);
    } finally {
      client.release();
    }
  });

  it("two logical clients back-to-back on one connection never see each other's scope", async () => {
    const client = await h.app.connect();
    try {
      const seenByA = await withWorkspaceOnClient(client, WS_A, (tx) =>
        tx.query("SELECT id FROM workspaces"),
      );
      const seenByB = await withWorkspaceOnClient(client, WS_B, (tx) =>
        tx.query("SELECT id FROM workspaces"),
      );
      expect(seenByA.rows.map((r) => r.id)).toEqual([WS_A]);
      expect(seenByB.rows.map((r) => r.id)).toEqual([WS_B]);
    } finally {
      client.release();
    }
  });

  it("context does not survive ROLLBACK either", async () => {
    const client = await h.app.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await client.query("ROLLBACK");
      const r = await client.query("SELECT current_setting('app.workspace_id', true) AS ws");
      expect(r.rows[0].ws ?? "").toBe("");
    } finally {
      client.release();
    }
  });
});

describe("SET SESSION is banned from the codebase", () => {
  it("no source or migration file uses SET SESSION / set_config(..., false)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    // Scope: shipped code (src/) and migrations (prisma/). Test files may
    // legitimately mention the banned pattern (this file does, to ban it).
    const roots = [join(here, "..", "src"), join(here, "..", "prisma")];
    const offenders: string[] = [];
    const scan = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist") continue;
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) scan(p);
        else if (/\.(ts|sql)$/.test(entry)) {
          const text = readFileSync(p, "utf8");
          if (/SET\s+SESSION\s+app\./i.test(text) || /set_config\([^)]*,\s*false\s*\)/i.test(text)) {
            offenders.push(p);
          }
        }
      }
    };
    for (const root of roots) scan(root);
    expect(offenders).toEqual([]);
  });
});
