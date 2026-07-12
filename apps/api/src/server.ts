/** API-only server: the route table behind a plain node:http dispatcher. */
import { createServer, type Server } from "node:http";

import { json } from "./http.js";
import { buildApiRoutes, type ApiDeps } from "./routes.js";

export function createApiServer(deps: ApiDeps = {}): Server {
  const routes = buildApiRoutes(deps);
  return createServer((req, res) => {
    const key = `${req.method} ${(req.url ?? "/").split("?")[0]}`;
    const handler = routes[key];
    if (!handler) return json(res, 404, { error: "not_found" });
    Promise.resolve(handler(req, res)).catch(() => {
      if (!res.headersSent) json(res, 500, { error: "internal" });
    });
  });
}
export type { ApiDeps } from "./routes.js";
