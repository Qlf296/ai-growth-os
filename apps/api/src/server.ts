/**
 * API skeleton (S2 §1). node:http + explicit route table — the structured
 * framework decision (S2 §5) is deferred until a real need (auth, step 8);
 * P2: triggers before replacements. No dependency until then.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const routes: Record<string, Handler> = {
  "GET /health": (_req, res) => json(res, 200, { status: "ok" }),
};

export function createApiServer(): Server {
  return createServer((req, res) => {
    const key = `${req.method} ${(req.url ?? "/").split("?")[0]}`;
    const handler = routes[key];
    if (handler) handler(req, res);
    else json(res, 404, { error: "not_found" });
  });
}
