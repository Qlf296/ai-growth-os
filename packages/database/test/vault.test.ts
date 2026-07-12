/**
 * AT-8 groundwork (I8 — tokens are sacred).
 * The app's default DB role must be structurally unable to read
 * provider_tokens. Only the vault role can — and even the vault role is
 * RLS-scoped to the current workspace. Envelope encryption itself lands with
 * the Connections module (Phase 1); the GRANT/RLS floor is Phase 0.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withWorkspace } from "../src/tenancy.js";
import { startHarness, seedWorkspace, type Harness } from "./harness.js";

let h: Harness;
const WS_A = randomUUID();
const WS_B = randomUUID();
const USER_A = randomUUID();
let connectionId: string;

beforeAll(async () => {
  h = await startHarness();
  await seedWorkspace(h.admin, WS_A, "A");
  await seedWorkspace(h.admin, WS_B, "B");
  await h.admin.query(
    `INSERT INTO users (id, email, auth_provider) VALUES ($1, 'a@test.dev', 'magic_link')`,
    [USER_A],
  );
  const r = await h.admin.query(
    `INSERT INTO connections (workspace_id, provider, status, scopes, capabilities, authorized_by)
     VALUES ($1, 'gsc', 'active', '{}', '{}', $2) RETURNING id`,
    [WS_A, USER_A],
  );
  connectionId = r.rows[0].id;
  await h.admin.query(
    `INSERT INTO provider_tokens (connection_id, enc_access_token, key_id, expires_at)
     VALUES ($1, '\\xdeadbeef', 'kms-key-1', now() + interval '1 hour')`,
    [connectionId],
  );
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe("I8 — provider_tokens grants", () => {
  it("app role: SELECT on provider_tokens is DENIED", async () => {
    await expect(
      withWorkspace(h.app, WS_A, (tx) => tx.query("SELECT * FROM provider_tokens")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("app role: INSERT/UPDATE/DELETE on provider_tokens are DENIED", async () => {
    await expect(
      withWorkspace(h.app, WS_A, (tx) =>
        tx.query(`INSERT INTO provider_tokens (connection_id, enc_access_token, key_id) VALUES ($1, '\\x00', 'k')`, [connectionId]),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withWorkspace(h.app, WS_A, (tx) => tx.query("DELETE FROM provider_tokens")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("vault role: can read tokens of the CURRENT workspace only (RLS on top of grants)", async () => {
    const mine = await withWorkspace(h.vault, WS_A, (tx) =>
      tx.query("SELECT connection_id, key_id FROM provider_tokens"),
    );
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0].connection_id).toBe(connectionId);

    const foreign = await withWorkspace(h.vault, WS_B, (tx) =>
      tx.query("SELECT connection_id FROM provider_tokens"),
    );
    expect(foreign.rows).toHaveLength(0);
  });

  it("vault role: cannot touch ordinary tenant tables beyond connections/provider_tokens", async () => {
    await expect(
      withWorkspace(h.vault, WS_A, (tx) => tx.query("SELECT * FROM memberships")),
    ).rejects.toThrow(/permission denied/i);
  });
});
