/**
 * BUILD_RULES step 11 — prove the invariants BITE.
 * Each test commits a real violation and asserts the guard rejects it FOR THE
 * RIGHT REASON. Violating files are created and removed inside the test; the
 * suite is a permanent, repeatable proof (a guard never tested against a real
 * violation is not a guard).
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConfigRegistry, InMemoryConfigStore, num } from "@aigos/config-registry";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain mjs module
import { checkDecisionConfig } from "../gates/checks.mjs";
import { startHarness, seedWorkspace, type Harness } from "../../packages/database/test/harness.js";
import { withWorkspace } from "../../packages/database/src/tenancy.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function depcruiseFails(violationFile: string, content: string): string {
  writeFileSync(violationFile, content);
  try {
    execSync("npx depcruise apps packages --config .dependency-cruiser.cjs", {
      cwd: root,
      stdio: "pipe",
    });
    return ""; // guard did NOT bite
  } catch (error) {
    return String((error as { stdout: Buffer }).stdout);
  } finally {
    unlinkSync(violationFile);
  }
}

describe("I6 — single LLM path (AT-6)", () => {
  it("an openai import outside ai-gateway is rejected by the build, naming AT-6", () => {
    const out = depcruiseFails(
      join(root, "packages/delivery/src/__violation_i6.ts"),
      'import "openai";\n',
    );
    expect(out).toContain("AT-6-single-llm-path");
    expect(out).toContain("__violation_i6.ts");
  });
});

describe("I7 — single send path (AT-7)", () => {
  it("a nodemailer import outside delivery is rejected by the build, naming AT-7", () => {
    const out = depcruiseFails(
      join(root, "packages/adapters/src/__violation_i7.ts"),
      'import "nodemailer";\n',
    );
    expect(out).toContain("AT-7-single-send-path");
  });
});

describe("AT-14 — decision-affecting changes are shadow-evaluated (I14)", () => {
  it("CI half: a weight change without a shadow-eval artifact is blocked, citing ADR-045", () => {
    const diff = `diff --git a/packages/recommendation/src/keys.ts b/packages/recommendation/src/keys.ts
-  defaultValue: 0.3,
+  defaultValue: 0.35,
`;
    const errors = checkDecisionConfig(diff);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/AT-14 \/ ADR-045/);
  });

  it("runtime half: the registry refuses the override, citing ADR-045", async () => {
    const registry = new ConfigRegistry(new InMemoryConfigStore());
    registry.define({
      key: "w",
      description: "d",
      owner: "o",
      stability: "experiment",
      decisionAffecting: true,
      schema: num({}),
      defaultValue: 0.3,
    });
    await expect(
      registry.setOverride("w", 0.4, { changedBy: "x", reason: "no eval" }),
    ).rejects.toThrow(/ADR-045/);
  });
});

describe("I4 — no claim without evidence (AT-4 tripwire)", () => {
  it("no render path exists yet; the day one appears, the evidence guard must exist first", () => {
    // Vacuously true in Phase 0 — this tripwire fails the build when the first
    // UI component lands without the evidence-reference component library.
    const offenders: string[] = [];
    const scan = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
        const p = join(dir, entry.name);
        if (entry.isDirectory()) scan(p);
        else if (/\.(tsx|jsx)$/.test(entry.name)) offenders.push(p);
      }
    };
    scan(join(root, "apps"));
    scan(join(root, "packages"));
    const evidenceGuardExists = offenders.length === 0 ||
      offenders.some((f) => readFileSync(f, "utf8").includes("evidenceReferenceId"));
    expect(evidenceGuardExists, `render files exist without an evidence guard: ${offenders.join(", ")}`).toBe(true);
  });
});

describe("I5 / I8 / I9 — database guards on real Postgres", () => {
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

  it("I5 — the append-only ledgers reject mutation: UPDATE/DELETE on config_overrides denied by GRANT", async () => {
    await expect(h.app.query("UPDATE config_overrides SET reason = 'tamper'")).rejects.toThrow(
      /permission denied/,
    );
    await expect(h.app.query("DELETE FROM audit_log")).rejects.toThrow(/permission denied/);
  });

  it("I8 — the app role cannot even SELECT provider_tokens (tokens are sacred)", async () => {
    await expect(
      withWorkspace(h.app, WS_A, (tx) => tx.query("SELECT * FROM provider_tokens")),
    ).rejects.toThrow(/permission denied for table provider_tokens/);
  });

  it("I9 — a forged cross-workspace INSERT dies on RLS, a cross-workspace read returns nothing", async () => {
    await expect(
      withWorkspace(h.app, WS_A, (tx) =>
        tx.query(`INSERT INTO connections (workspace_id, provider, status, scopes, capabilities, authorized_by)
                  VALUES ($1, 'gsc', 'active', '{}', '{}', $1)`, [WS_B]),
      ),
    ).rejects.toThrow(/row-level security policy/);
    const foreign = await withWorkspace(h.app, WS_B, (tx) =>
      tx.query("SELECT * FROM workspaces WHERE id = $1", [WS_A]),
    );
    expect(foreign.rowCount).toBe(0);
  });
});
