/**
 * Web runtime (S2 §1: ONE process = SSR + API). SSR pages guard sessions
 * directly via SessionService (same process — no HTTP loopback); everything
 * not a page falls through to the existing API route table.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { buildApiRoutes, cookies, json, type ApiDeps } from "@aigos/app-api";

import { confirmPage, loginPage, sectionPage, SECTION_PATHS } from "./pages.js";

const html = (res: ServerResponse, status: number, body: string): void => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
};

const redirect = (res: ServerResponse, location: string): void => {
  res.writeHead(302, { location });
  res.end();
};

export function createWebServer(deps: ApiDeps = {}): Server {
  const api = buildApiRoutes(deps);

  const currentUser = async (req: IncomingMessage): Promise<{ email: string } | null> => {
    const { pool, sessions } = deps;
    if (!pool || !sessions) return null;
    const sid = cookies(req).sid;
    const session = sid ? await sessions.validate(sid) : null;
    if (!session) return null;
    const user = await pool.query(`SELECT email FROM users WHERE id = $1`, [session.userId]);
    return user.rows[0] as { email: string };
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
