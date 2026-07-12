/**
 * API skeleton (S2 §1). node:http + explicit route table — the structured
 * framework decision (S2 §5) is deferred until a real need (P2).
 * /health runs the HealthRegistry (ADR-047): 200 healthy, 503 otherwise.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { HealthRegistry } from "@aigos/infra";

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export interface ApiDeps {
  readonly health?: HealthRegistry;
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

export function createApiServer(deps: ApiDeps = {}): Server {
  const health = deps.health ?? new HealthRegistry();

  const routes: Record<string, Handler> = {
    "GET /health": async (_req, res) => {
      const report = await health.run();
      json(res, report.healthy ? 200 : 503, { status: report.healthy ? "ok" : "degraded", checks: report.checks });
    },
  };

  return createServer((req, res) => {
    const key = `${req.method} ${(req.url ?? "/").split("?")[0]}`;
    const handler = routes[key];
    if (handler) void handler(req, res);
    else json(res, 404, { error: "not_found" });
  });
}
