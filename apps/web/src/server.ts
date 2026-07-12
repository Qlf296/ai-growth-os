/**
 * Web runtime (S2 §1: ONE process = SSR + API). SSR pages guard sessions
 * directly via SessionService (same process — no HTTP loopback); everything
 * not a page falls through to the existing API route table.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { ConnectionRepository, listUserWorkspaces, withWorkspace } from "@aigos/database";

import { buildDigest } from "@aigos/action";

import { buildApiRoutes, cookies, json, type ApiDeps } from "@aigos/app-api";

import { confirmPage, loginPage, sectionPage, settingsPage, todayPage, SECTION_PATHS } from "./pages.js";

const html = (res: ServerResponse, status: number, body: string): void => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
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
