/** Disposable end-to-end check: boots the real runtime, issues a session, and
 * fetches every page in-process (no curl fork storm). Prints a status table. */
import { createWebServer } from "@aigos/app-web";
import { HealthRegistry } from "@aigos/infra";

import { buildRuntime } from "./runtime.mjs";

const rt = await buildRuntime();
const health = new HealthRegistry();
health.register("postgres", async () => { try { await rt.pool.query("SELECT 1"); return true; } catch { return false; } });

const web = createWebServer({ pool: rt.pool, sessions: rt.sessions, magic: rt.magic, health });
await new Promise<void>((r) => web.listen(0, "127.0.0.1", () => r()));
const addr = web.address();
const base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";

const user = await rt.pool.query(`SELECT id FROM users WHERE email = $1`, [rt.demo.email]);
const userId = user.rows[0].id as string;
const issued = await rt.sessions.issue(userId, "chrome-mac", "127.0.0.1");
const auth = { headers: { cookie: `sid=${issued.sessionId}`, "user-agent": "chrome" } } as const;

const rows: string[] = [];
const check = async (label: string, path: string, opts: RequestInit = {}) => {
  const res = await fetch(base + path, opts);
  rows.push(`${res.status}  ${label.padEnd(14)} ${path}`);
  return res;
};

await check("health", "/health");
await check("login", "/login");
const anon = await fetch(base + "/", { redirect: "manual" });
rows.push(`${anon.status}  ${"anon /".padEnd(14)} -> ${anon.headers.get("location")}`);
const dash = await check("dashboard", "/", auth);
const dashBody = await dash.text();
for (const p of ["/actions", "/connections", "/experiments", "/automations", "/learnings", "/notifications", "/usage", "/settings", "/admin"]) {
  await check(p.slice(1), p, auth);
}
const actions = await (await fetch(base + "/actions", auth)).text();

console.log("\n===== PAGE STATUS =====");
console.log(rows.join("\n"));
console.log("\n===== DEMO DATA =====");
console.log("dashboard shows CTR-gap opportunity:", /ctr gap|close the ctr|cv-sans-experience/i.test(dashBody));
console.log("actions shows the seeded draft:     ", /cv sans exp|seo_title|draft/i.test(actions));
console.log("worker scheduler tick importable:   ", typeof (await import("@aigos/app-worker")).tick === "function");

web.close();
await rt.stop();
console.log("\nDONE");
process.exit(0);
