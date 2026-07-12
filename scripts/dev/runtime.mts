/**
 * Local dev composition root (bootstrap only — NOT product code, NOT part of
 * the tsc build graph or architecture tests). It wires the EXISTING packages
 * and apps together so Web + API + Worker actually run on a laptop with no
 * external services:
 *   - Postgres  -> embedded-postgres (persistent under .localdb) or DATABASE_URL
 *   - Redis     -> in-memory Cache / JobQueue fallbacks (already in @aigos/infra)
 *   - Email     -> console Delivery that prints the magic-link (offline login)
 *
 * No invariant is weakened: the app runs as the RLS-constrained `aigos_app`
 * role, tokens stay vault-only, and login is the real magic-link flow.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";

import { applyMigrations, provisionOnSignIn, withWorkspace } from "@aigos/database";
import { MagicLinkService, SessionService } from "@aigos/identity";
import { Delivery, NotificationTypeRegistry } from "@aigos/delivery";
import { Logger, MetricsRegistry } from "@aigos/infra";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "demo@forgcv.com";
const BASE_URL = process.env.APP_BASE_URL ?? `http://localhost:${Number(process.env.PORT ?? 3000)}`;

export interface Runtime {
  pool: pg.Pool;
  sessions: SessionService;
  magic: MagicLinkService;
  logger: Logger;
  metrics: MetricsRegistry;
  demo: { email: string; workspaceId: string; workspaceName: string };
  stop: () => Promise<void>;
}

/** Boot Postgres: a real DATABASE_URL if provided, else embedded (persistent). */
async function bootPostgres(): Promise<{ adminUrl: string; stop: () => Promise<void> }> {
  if (process.env.DATABASE_URL) {
    return { adminUrl: process.env.DATABASE_URL, stop: async () => {} };
  }
  const dataDir = join(repoRoot, ".localdb");
  const port = Number(process.env.PGPORT ?? 55432);
  const fresh = !existsSync(join(dataDir, "PG_VERSION"));
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port, persistent: true });
  if (fresh) await server.initialise();
  await server.start();
  return {
    adminUrl: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
    stop: async () => {
      await server.stop();
    },
  };
}

/** Idempotent demo seed: workspace + owner + one active opportunity, recommendation and draft. */
async function seedDemo(app: pg.Pool): Promise<{ email: string; workspaceId: string; workspaceName: string }> {
  const { workspaces } = await provisionOnSignIn(app, DEMO_EMAIL);
  const ws = workspaces[0]!;
  await withWorkspace(app, ws.id, async (tx) => {
    const existing = await tx.query(`SELECT count(*)::int n FROM opportunities`);
    if ((existing.rows[0] as { n: number }).n > 0) return; // already seeded

    const scope = `NULLIF(current_setting('app.workspace_id', true), '')::uuid`;
    const evId = randomUUID();
    await tx.query(
      `INSERT INTO evidence (id, workspace_id, generated_by, data)
       VALUES ($1, ${scope}, 'seo.ctr_gap@1', '{"metric":"ctr","observed":0.011,"expected":0.031,"clicks":128,"impressions":11600}'::jsonb)`,
      [evId],
    );
    const opp = await tx.query(
      `INSERT INTO opportunities (workspace_id, entity, category, detectors, severity, confidence, impact, difficulty, effort, roi,
         priority_score, score_trace, evidence_ids, occurred_on, dedupe_hash)
       VALUES (${scope}, 'https://forgcv.com/cv-sans-experience', 'seo', '["seo.ctr_gap"]'::jsonb,
         'high', 'high', 'high', 'low', 'low', '{"monetized":false}'::jsonb,
         0.82, '{"base":0.6,"factors":{"impact":0.15,"confidence":0.07}}'::jsonb, $1::jsonb, current_date, $2)
       RETURNING id`,
      [JSON.stringify([evId]), "demo-ctr-gap-cv-sans-experience"],
    );
    const oppId = (opp.rows[0] as { id: string }).id;
    const rec = await tx.query(
      `INSERT INTO recommendations (workspace_id, opportunity_id, title, summary, business_reason, technical_reason,
         expected_impact, evidence_ids, affected_entities, prerequisites, steps, rollback)
       VALUES (${scope}, $1,
         'Rewrite the title & meta description to close the CTR gap',
         'This page ranks on page 1 but its click-through rate is a third of the expected rate for its position.',
         'Recovering expected CTR on 11.6k monthly impressions is the single biggest quick win in the current data.',
         'Rewrite <title> to lead with the primary query and add a benefit-driven meta description under 155 chars.',
         'clicks', $2::jsonb, '["https://forgcv.com/cv-sans-experience"]'::jsonb, '[]'::jsonb,
         '["Draft a new title tag","Draft a new meta description","Publish via CMS","Request re-crawl"]'::jsonb,
         'Restore the previous title and meta description from the CMS revision history.')
       RETURNING id`,
      [oppId, JSON.stringify([evId])],
    );
    const recId = (rec.rows[0] as { id: string }).id;
    await tx.query(
      `INSERT INTO drafts (workspace_id, recommendation_id, draft_type, content, prompt_template_id, prompt_template_version,
         provider, tier, cached, trace_id, input_tokens, output_tokens, cost_eur, evidence_ids, status)
       VALUES (${scope}, $1, 'seo_title',
         'CV sans expérience : le guide 2026 pour décrocher un entretien (modèles inclus)',
         'draft.seo_title', 3, 'demo', 't3', false, gen_random_uuid(), 0, 0, 0, $2::jsonb, 'draft')`,
      [recId, JSON.stringify([evId])],
    );
  });
  return { email: DEMO_EMAIL, workspaceId: ws.id, workspaceName: ws.name };
}

export async function buildRuntime(): Promise<Runtime> {
  const logger = new Logger({ context: { service: "aigos-dev" } });
  const metrics = new MetricsRegistry();

  const { adminUrl, stop: stopPg } = await bootPostgres();
  const admin = new pg.Pool({ connectionString: adminUrl });
  logger.info("applying migrations");
  const applied = await applyMigrations(admin);
  logger.info("migrations ready", { applied: applied.length });

  // Run the app as the RLS-constrained role (I9) — same role the tests use.
  const appUrl = adminUrl.includes("127.0.0.1")
    ? adminUrl.replace("postgres:postgres@", "aigos_app:app_pw_test@")
    : adminUrl;
  const pool = new pg.Pool({ connectionString: appUrl, max: 8 });

  const demo = await seedDemo(pool);
  logger.info("demo workspace ready", { email: demo.email, workspace: demo.workspaceName });

  // Console delivery: prints the magic-link instead of sending an email (offline login).
  const registry = new NotificationTypeRegistry();
  registry.register({ type: "security_transactional", channel: "email", dailyBudget: 0, cooldownSeconds: 0, budgetExempt: true });
  const delivery = new Delivery({
    registry,
    channels: [
      {
        channel: "email",
        send: async (msg: { to: string; body: string }) => {
          const link = /https?:\/\/\S+\/auth\/confirm\?token=[a-f0-9]+/.exec(msg.body)?.[0];
          console.log("\n[36m[1m🔑  SIGN-IN LINK for " + msg.to + ":[0m\n    " + (link ?? msg.body) + "\n");
        },
      },
    ],
    ledger: async () => {},
    clock: () => new Date(),
  });

  const sessions = new SessionService(pool, () => new Date());
  const magic = new MagicLinkService(pool, delivery, () => new Date(), {
    baseUrl: BASE_URL,
    maxPerEmailPerHour: 100,
    maxPerIpPerHour: 100,
  });

  return {
    pool,
    sessions,
    magic,
    logger,
    metrics,
    demo,
    stop: async () => {
      await pool.end().catch(() => {});
      await admin.end().catch(() => {});
      await stopPg();
    },
  };
}
