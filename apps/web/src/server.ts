/**
 * Web runtime (S2 §1: ONE process = SSR + API). SSR pages guard sessions
 * directly via SessionService (same process — no HTTP loopback); everything
 * not a page falls through to the existing API route table.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { ConnectionRepository, getSyncState, listUserWorkspaces, withWorkspace } from "@aigos/database";

import { buildDigest, listDrafts, usageSummary } from "@aigos/action";
import { getOpportunityDetail } from "@aigos/growth";
import { listExecutions, listExperiments, listRules } from "@aigos/automation";

import { buildApiRoutes, cookies, json, type ApiDeps } from "@aigos/app-api";

import { actionsPage, adminPage, automationsPage, confirmPage, connectionsPage, experimentsDataPage, loginPage, notificationsPage, opportunityPage, sectionPage, settingsPage, todayPage, usagePage, SECTION_PATHS } from "./pages.js";

const html = (res: ServerResponse, status: number, body: string): void => {
  // Per-user SSR: never store in shared caches (correctness + performance hygiene).
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" });
  res.end(body);
};

const redirect = (res: ServerResponse, location: string): void => {
  res.writeHead(302, { location });
  res.end();
};

export interface WebDeps extends ApiDeps {
  readonly clock?: () => Date;
}

export function createWebServer(deps: WebDeps = {}): Server {
  const api = buildApiRoutes(deps);
  const clock = deps.clock ?? (() => new Date());

  const currentUser = async (req: IncomingMessage): Promise<{ id: string; email: string; locale: string } | null> => {
    const { pool, sessions } = deps;
    if (!pool || !sessions) return null;
    const sid = cookies(req).sid;
    const session = sid ? await sessions.validate(sid) : null;
    if (!session) return null;
    const user = await pool.query(`SELECT id, email, locale FROM users WHERE id = $1`, [session.userId]);
    return user.rows[0] as { id: string; email: string; locale: string };
  };

  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const path = url.pathname;
    const method = req.method ?? "GET";

    const handle = async (): Promise<void> => {
      if (method === "GET" && path === "/login") {
        const user = await currentUser(req);
        return user ? redirect(res, "/") : html(res, 200, loginPage());
      }
      if (method === "GET" && path === "/auth/confirm") {
        const token = url.searchParams.get("token") ?? "";
        return /^[a-f0-9]{64}$/.test(token) ? html(res, 200, confirmPage(token)) : redirect(res, "/login");
      }
      if (method === "GET" && path === "/") {
        const user = await currentUser(req);
        if (!user) return redirect(res, "/login");
        const pool = deps.pool!;
        const workspaces = await listUserWorkspaces(pool, user.id); // single-workspace UI (ADR-018 Model A)
        const first = workspaces[0]!;
        const ws = await withWorkspace(pool, first.id, (tx) =>
          tx.query(`SELECT name, plan_id FROM workspaces WHERE id = $1`, [first.id]),
        );
        const row = ws.rows[0] as { name: string; plan_id: string };
        const day = clock().toISOString().slice(0, 10);
        const digest = await buildDigest(pool, first.id, day); // real data from repositories only
        return html(res, 200, todayPage({
          email: user.email, locale: user.locale, workspaceName: row.name, planId: row.plan_id, date: clock(), digest,
        }));
      }
      if (method === "GET" && path.startsWith("/opportunities/")) {
        const user = await currentUser(req);
        if (!user) return redirect(res, "/login");
        const pool = deps.pool!;
        const id = path.slice("/opportunities/".length);
        if (!/^[0-9a-f-]{36}$/.test(id)) return json(res, 404, { error: "not_found" });
        const first = (await listUserWorkspaces(pool, user.id))[0]!;
        const detail = await getOpportunityDetail(pool, first.id, id);
        if (!detail) return json(res, 404, { error: "not_found" });
        return html(res, 200, opportunityPage(user.email, detail));
      }
      if (method === "GET" && path === "/usage") {
        const user = await currentUser(req);
        if (!user) return redirect(res, "/login");
        const pool = deps.pool!;
        const first = (await listUserWorkspaces(pool, user.id))[0]!;
        return html(res, 200, usagePage(user.email, await usageSummary(pool, first.id)));
      }
      if (method === "GET" && path === "/admin") {
        const user = await currentUser(req);
        if (!user) return redirect(res, "/login");
        const pool = deps.pool!;
        const first = (await listUserWorkspaces(pool, user.id))[0]!;
        const view = await withWorkspace(pool, first.id, async (tx) => {
          const w = await tx.query(`SELECT w.name, w.region, w.plan_id, p.limits FROM workspaces w JOIN plans p ON p.id = w.plan_id WHERE w.id = $1`, [first.id]);
          const m = await tx.query(`SELECT u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id ORDER BY m.created_at`);
          const u = await tx.query(`SELECT count(*)::int AS requests, coalesce(sum(cost_eur),0)::float AS cost, coalesce(sum(input_tokens),0)::int AS it, coalesce(sum(output_tokens),0)::int AS ot FROM llm_calls`);
          const wr = w.rows[0] as Record<string, unknown>;
          const ur = u.rows[0] as Record<string, unknown>;
          return {
            workspaceName: wr.name as string, region: wr.region as string, planId: wr.plan_id as string, limits: wr.limits as Record<string, unknown>,
            members: (m.rows as Array<{ email: string; role: string }>),
            usage: { requests: ur.requests as number, costEur: ur.cost as number, inputTokens: ur.it as number, outputTokens: ur.ot as number },
          };
        });
        return html(res, 200, adminPage(user.email, view));
      }
      if (method === "GET" && path === "/notifications") {
        const user = await currentUser(req);
        if (!user) return redirect(res, "/login");
        // Delivery does not yet persist a send history → honest empty categories (no fake data).
        return html(res, 200, notificationsPage(user.email, []));
      }
      if (method === "GET" && path === "/connections") {
        const user = await currentUser(req);
        if (!user) return redirect(res, "/login");
        const pool = deps.pool!;
        const first = (await listUserWorkspaces(pool, user.id))[0]!;
        const conns = await withWorkspace(pool, first.id, (tx) => new ConnectionRepository().list(tx));
        const views = [];
        for (const c of conns) {
          const st = await getSyncState(pool, first.id, c.id);
          views.push({
            id: c.id, provider: c.provider, status: c.status, healthStatus: c.healthStatus,
            scopes: c.scopes, site: c.externalAccountRef,
            lastSuccessfulSync: st?.lastSuccessfulSync ? st.lastSuccessfulSync.toISOString().slice(0, 10) : null,
            lastAttemptedSync: st?.lastAttemptedSync ? st.lastAttemptedSync.toISOString().slice(0, 19) : null,
            importedRows: st?.importedRows ?? 0, apiQuotaUsed: st?.apiQuotaUsed ?? 0, lastError: st?.lastError ?? null,
            needsReconnect: c.healthStatus === "reconnect_required" || c.status === "expired" || c.status === "revoked",
          });
        }
        return html(res, 200, connectionsPage(user.email, first.id, views));
      }
      if (method === "GET" && path === "/experiments") {
        const user = await currentUser(req);
        if (!user) return redirect(res, "/login");
        const pool = deps.pool!;
        const first = (await listUserWorkspaces(pool, user.id))[0]!;
        return html(res, 200, experimentsDataPage(user.email, await listExperiments(pool, first.id)));
      }
      if (method === "GET" && path === "/automations") {
        const user = await currentUser(req);
        if (!user) return redirect(res, "/login");
        const pool = deps.pool!;
        const first = (await listUserWorkspaces(pool, user.id))[0]!;
        return html(res, 200, automationsPage(user.email, await listRules(pool, first.id), await listExecutions(pool, first.id)));
      }
      if (method === "GET" && path === "/actions") {
        const user = await currentUser(req);
        if (!user) return redirect(res, "/login");
        const pool = deps.pool!;
        const first = (await listUserWorkspaces(pool, user.id))[0]!;
        const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
        const drafts = await listDrafts(pool, first.id, { page, pageSize: 5 });
        return html(res, 200, actionsPage(user.email, first.id, drafts));
      }
      if (method === "GET" && path === "/settings") {
        const user = await currentUser(req);
        if (!user) return redirect(res, "/login");
        const pool = deps.pool!;
        const sid = cookies(req).sid!;
        const workspaces = await listUserWorkspaces(pool, user.id);
        const first = workspaces[0]!;
        const ws = await withWorkspace(pool, first.id, (tx) =>
          tx.query(`SELECT name, region, plan_id FROM workspaces WHERE id = $1`, [first.id]),
        );
        const row = ws.rows[0] as { name: string; region: string; plan_id: string };
        const devices = (await deps.sessions!.listActiveForUser(user.id)).map((d) => ({
          id: d.sessionId, uaFamily: d.uaFamily, createdAt: d.createdAt, current: d.sessionId === sid,
        }));
        const connections = (
          await withWorkspace(pool, first.id, (tx) => new ConnectionRepository().list(tx))
        ).map((c) => ({ provider: c.provider, status: c.status }));
        return html(res, 200, settingsPage({
          email: user.email, locale: user.locale, workspaceId: first.id, workspaceName: row.name,
          region: row.region, planId: row.plan_id, devices, connections,
        }));
      }
      if (method === "GET" && SECTION_PATHS.includes(path)) {
        const user = await currentUser(req);
        return user ? html(res, 200, sectionPage(path, user.email)) : redirect(res, "/login");
      }
      const apiHandler = api[`${method} ${path}`];
      if (apiHandler) return apiHandler(req, res) as Promise<void>;
      json(res, 404, { error: "not_found" });
    };

    handle().catch(() => {
      if (!res.headersSent) json(res, 500, { error: "internal" });
    });
  });
}
