/**
 * AT-9 — tenant-isolation leak suite (I9). Standing test: red build on any leak.
 * For every tenant table reachable by the app role: cross-workspace read,
 * write, update and delete must all come back empty / rejected.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withWorkspace } from "../src/tenancy.js";
import { ConnectionRepository } from "../src/repositories/connections.js";
import { MembershipRepository } from "../src/repositories/memberships.js";
import { startHarness, seedWorkspace, type Harness } from "./harness.js";

let h: Harness;
const WS_A = randomUUID();
const WS_B = randomUUID();
const USER_A = randomUUID();

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS_A, "Workspace A");
  await seedWorkspace(h.admin, WS_B, "Workspace B");
  await h.admin.query(
    `INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@test.dev', 'magic_link')`,
    [USER_A],
  );
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe("AT-9 — workspaces table", () => {
  it("a workspace context can only see its own workspace row", async () => {
    const rowsA = await withWorkspace(h.app, WS_A, (tx) =>
      tx.query("SELECT id FROM workspaces"),
    );
    expect(rowsA.rows.map((r) => r.id)).toEqual([WS_A]);
  });

  it("cross-workspace UPDATE hits zero rows", async () => {
    const result = await withWorkspace(h.app, WS_A, (tx) =>
      tx.query("UPDATE workspaces SET name = 'pwned' WHERE id = $1", [WS_B]),
    );
    expect(result.rowCount).toBe(0);
    const check = await h.admin.query("SELECT name FROM workspaces WHERE id = $1", [WS_B]);
    expect(check.rows[0].name).toBe("Workspace B");
  });
});

describe("AT-9 — memberships repository", () => {
  it("insert lands in the scoped workspace; the other workspace reads nothing", async () => {
    const repo = new MembershipRepository();
    await withWorkspace(h.app, WS_A, (tx) => repo.add(tx, { userId: USER_A, role: "owner" }));
    const inA = await withWorkspace(h.app, WS_A, (tx) => repo.list(tx));
    const inB = await withWorkspace(h.app, WS_B, (tx) => repo.list(tx));
    expect(inA).toHaveLength(1);
    expect(inB).toHaveLength(0);
  });

  it("forging a foreign workspace_id in an INSERT is rejected by WITH CHECK", async () => {
    await expect(
      withWorkspace(h.app, WS_A, (tx) =>
        tx.query(
          `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
          [WS_B, USER_A],
        ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });
});

describe("AT-9 — connections repository (ADR-019)", () => {
  it("connection is workspace-owned, records authorized_by, and never leaks", async () => {
    const repo = new ConnectionRepository();
    const id = await withWorkspace(h.app, WS_A, (tx) =>
      repo.create(tx, {
        provider: "gsc",
        scopes: ["webmasters.readonly"],
        capabilities: { read_search_analytics: true },
        authorizedBy: USER_A,
      }),
    );
    expect(id).toBeTruthy();
    const inB = await withWorkspace(h.app, WS_B, (tx) => repo.list(tx));
    expect(inB).toHaveLength(0);
    const inA = await withWorkspace(h.app, WS_A, (tx) => repo.list(tx));
    expect(inA).toHaveLength(1);
    expect(inA[0]?.authorizedBy).toBe(USER_A);
  });

  it("creating a connection without authorized_by is impossible (ADR-019, NOT NULL)", async () => {
    await expect(
      withWorkspace(h.app, WS_A, (tx) =>
        tx.query(
          `INSERT INTO connections (workspace_id, provider, status, scopes, capabilities)
           VALUES ($1, 'ga4', 'active', '{}', '{}')`,
          [WS_A],
        ),
      ),
    ).rejects.toThrow(/null value|not-null/i);
  });

  it("cross-workspace DELETE hits zero rows", async () => {
    const result = await withWorkspace(h.app, WS_B, (tx) =>
      tx.query("DELETE FROM connections"),
    );
    expect(result.rowCount).toBe(0);
    const still = await h.admin.query("SELECT count(*)::int AS n FROM connections");
    expect(still.rows[0].n).toBe(1);
  });
});

describe("AT-9 — no context, no rows", () => {
  it("a query without any workspace context sees zero tenant rows", async () => {
    const client = await h.app.connect();
    try {
      const r = await client.query("SELECT count(*)::int AS n FROM connections");
      expect(r.rows[0].n).toBe(0);
    } finally {
      client.release();
    }
  });
});
