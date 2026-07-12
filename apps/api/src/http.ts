/** Tiny HTTP helpers — no framework until a trigger fires (P2). */
import type { IncomingMessage, ServerResponse } from "node:http";

export const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(status === 204 ? undefined : JSON.stringify(body));
};

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function cookies(req: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim().split("=") as [string, string])
      .filter((kv) => kv.length === 2 && kv[0]),
  );
}

/** httpOnly + Secure + SameSite=Lax (ADR-017). Max-Age 0 clears. */
export function sessionCookie(name: string, value: string, maxAgeSeconds: number, path = "/"): string {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=${path}; Max-Age=${maxAgeSeconds}`;
}

/** Coarse browser/OS bucket — binds tokens (ADR-016) without fingerprinting. */
export function uaFamily(req: IncomingMessage): string {
  const ua = req.headers["user-agent"] ?? "unknown";
  const browser = /(firefox|chrome|safari|edg|curl|node)/i.exec(ua)?.[1] ?? "other";
  const os = /(windows|mac|linux|android|ios)/i.exec(ua)?.[1] ?? "other";
  return `${browser.toLowerCase()}-${os.toLowerCase()}`;
}

export function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  return (typeof fwd === "string" ? fwd.split(",")[0]?.trim() : undefined) ?? req.socket.remoteAddress ?? "0.0.0.0";
}
