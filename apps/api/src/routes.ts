/**
 * API route table (S2 §1) — consumed by createApiServer AND the web process
 * (one runtime: API + SSR). Auth per ADR-016/017; CSRF header on POSTs
 * (S6 §2); generic auth errors — no account-existence oracle.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import type pg from "pg";

import { isMember, listUserWorkspaces, provisionOnSignIn, withWorkspace } from "@aigos/database";
import type { MagicLinkService, SessionService } from "@aigos/identity";
import { HealthRegistry } from "@aigos/infra";

import { clientIp, cookies, json, readJson, sessionCookie, uaFamily } from "./http.js";

export interface ApiDeps {
  readonly health?: HealthRegistry;
  readonly pool?: pg.Pool;
  readonly magic?: MagicLinkService;
  readonly sessions?: SessionService;
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

const ACCESS_COOKIE_SECONDS = 15 * 60;        // mirrors SessionService accessTtl (ADR-017)
const REFRESH_COOKIE_SECONDS = 30 * 86_400;   // mirrors refresh horizon (S6 §7)

export function buildApiRoutes(deps: ApiDeps = {}): Record<string, Handler> {
  const health = deps.health ?? new HealthRegistry();

  const auth = () => {
    const { pool, magic, sessions } = deps;
    if (!pool || !magic || !sessions) throw new Error("auth routes need pool+magic+sessions wiring");
    return { pool, magic, sessions };
  };

  const csrfOk = (req: IncomingMessage): boolean => req.headers["x-csrf"] === "1";

  /** Authenticated session from the sid cookie — null means 401. */
  const currentSession = async (req: IncomingMessage) => {
    const { sessions } = auth();
    const sid = cookies(req).sid;
    return sid ? sessions.validate(sid) : null;
  };

  const setSessionCookies = (res: ServerResponse, sessionId: string, refreshToken: string): void => {
    res.setHeader("set-cookie", [
      sessionCookie("sid", sessionId, ACCESS_COOKIE_SECONDS),
      sessionCookie("refresh", refreshToken, REFRESH_COOKIE_SECONDS, "/auth/refresh"),
    ]);
  };

  const routes: Record<string, Handler> = {
    "GET /health": async (_req, res) => {
      const report = await health.run();
      json(res, report.healthy ? 200 : 503, { status: report.healthy ? "ok" : "degraded", checks: report.checks });
    },

    "GET /me": async (req, res) => {
      const { pool } = auth();
      const session = await currentSession(req);
      if (!session) return json(res, 401, { error: "unauthenticated" });
      const user = await pool.query(`SELECT id, email, locale FROM users WHERE id = $1`, [session.userId]);
      const workspaces = await listUserWorkspaces(pool, session.userId);
      json(res, 200, { user: user.rows[0], workspaces });
    },

    "GET /me/workspace": async (req, res) => {
      const { pool } = auth();
      const session = await currentSession(req);
      if (!session) return json(res, 401, { error: "unauthenticated" });
      const workspaceId = typeof req.headers["x-workspace-id"] === "string" ? req.headers["x-workspace-id"] : "";
      if (!/^[0-9a-f-]{36}$/.test(workspaceId) || !(await isMember(pool, session.userId, workspaceId))) {
        return json(res, 403, { error: "not_a_member" }); // membership check gates the RLS scope (S6 §2)
      }
      // per-request RLS scope: everything below runs inside SET LOCAL app.workspace_id
      const ws = await withWorkspace(pool, workspaceId, (tx) =>
        tx.query(
          `SELECT w.id, w.name, w.region, w.plan_id, p.limits
           FROM workspaces w JOIN plans p ON p.id = w.plan_id WHERE w.id = $1`,
          [workspaceId],
        ),
      );
      json(res, 200, { workspace: ws.rows[0] });
    },

    "GET /me/sessions": async (req, res) => {
      const { sessions } = auth();
      const session = await currentSession(req);
      if (!session) return json(res, 401, { error: "unauthenticated" });
      const devices = await sessions.listActiveForUser(session.userId);
      json(res, 200, {
        sessions: devices.map((d) => ({
          id: d.sessionId, uaFamily: d.uaFamily, createdAt: d.createdAt, current: d.sessionId === session.sessionId,
        })),
      });
    },

    "POST /me/sessions/revoke": async (req, res) => {
      if (!csrfOk(req)) return json(res, 403, { error: "csrf" });
      const { sessions } = auth();
      const session = await currentSession(req);
      if (!session) return json(res, 401, { error: "unauthenticated" });
      const body = await readJson(req);
      const target = typeof body.sessionId === "string" ? body.sessionId : "";
      const done = target ? await sessions.revokeIfOwned(session.userId, target) : false;
      done ? json(res, 204, undefined) : json(res, 404, { error: "not_found" });
    },

    "POST /me/sessions/revoke-others": async (req, res) => {
      if (!csrfOk(req)) return json(res, 403, { error: "csrf" });
      const { sessions } = auth();
      const session = await currentSession(req);
      if (!session) return json(res, 401, { error: "unauthenticated" });
      await sessions.revokeOtherSessions(session.userId, session.sessionId);
      json(res, 204, undefined);
    },

    "POST /auth/request-link": async (req, res) => {
      if (!csrfOk(req)) return json(res, 403, { error: "csrf" });
      const { magic } = auth();
      const body = await readJson(req);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (email.includes("@")) await magic.request(email, uaFamily(req), clientIp(req));
      json(res, 204, undefined); // always the same answer — no oracle (S6 §2)
    },

    "POST /auth/confirm": async (req, res) => {
      if (!csrfOk(req)) return json(res, 403, { error: "csrf" });
      const { pool, magic, sessions } = auth();
      const body = await readJson(req);
      const token = typeof body.token === "string" ? body.token : "";
      const email = token ? await magic.consume(token, uaFamily(req)) : null;
      if (!email) return json(res, 401, { error: "invalid_or_expired" }); // generic
      const identity = await provisionOnSignIn(pool, email);
      const issued = await sessions.issue(identity.userId, uaFamily(req), clientIp(req));
      await pool.query(`INSERT INTO audit_log (actor, event) VALUES ($1, 'signin.success')`, [email]);
      setSessionCookies(res, issued.sessionId, issued.refreshToken);
      json(res, 200, { userId: identity.userId, workspaces: identity.workspaces });
    },

    "POST /auth/refresh": async (req, res) => {
      if (!csrfOk(req)) return json(res, 403, { error: "csrf" });
      const { sessions } = auth();
      const token = cookies(req).refresh ?? "";
      const rotated = token ? await sessions.refresh(token, uaFamily(req)) : null;
      if (!rotated) return json(res, 401, { error: "invalid_or_expired" });
      setSessionCookies(res, rotated.sessionId, rotated.refreshToken);
      json(res, 200, { ok: true });
    },

    "POST /auth/logout": async (req, res) => {
      if (!csrfOk(req)) return json(res, 403, { error: "csrf" });
      const { sessions } = auth();
      const sid = cookies(req).sid;
      if (sid) await sessions.revoke(sid);
      res.setHeader("set-cookie", [sessionCookie("sid", "", 0), sessionCookie("refresh", "", 0, "/auth/refresh")]);
      json(res, 204, undefined);
    },
  };

  return routes;
}
