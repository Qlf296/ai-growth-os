/**
 * `npm run dev` entrypoint (bootstrap only). Starts the whole stack in one
 * process on http://localhost:3000 :
 *   - Web SSR server (which also mounts the API route table) on PORT
 *   - Worker: in-memory queue + scheduler tick loop (no Redis needed)
 * Ctrl-C shuts everything down cleanly. No product code is modified.
 */
import { InMemoryJobQueue, HealthRegistry } from "@aigos/infra";
import { listEnabledSystemJobs } from "@aigos/database";
import { createWebServer } from "@aigos/app-web";
import { tick, canaryHandler, type SchedulerPayload } from "@aigos/app-worker";

import { buildRuntime } from "./runtime.mjs";

const PORT = Number(process.env.PORT ?? 3000);

const rt = await buildRuntime();

// --- Health probes (readiness of the one hard dependency: Postgres) ------------
const health = new HealthRegistry();
health.register("postgres", async () => {
  try {
    await rt.pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
});

// --- Web + API (single process, SSR mounts the API routes) ---------------------
const web = createWebServer({ pool: rt.pool, sessions: rt.sessions, magic: rt.magic, health });
await new Promise<void>((r) => web.listen(PORT, r));

// --- Worker: scheduler tick loop over the in-memory queue ----------------------
const queue = new InMemoryJobQueue<SchedulerPayload>();
const runCanary = canaryHandler(rt.logger, rt.metrics);
queue.process(async (job) => {
  if (job.payload.family === "canary.spine") await runCanary(job);
  else rt.logger.info("worker: job processed", { family: job.payload.family, jobId: job.jobId });
});

let lastTick = new Date(Date.now() - 60_000);
const workerTimer = setInterval(() => {
  void (async () => {
    const now = new Date();
    try {
      const defs = (await listEnabledSystemJobs(rt.pool)).map((j) => ({
        id: j.id,
        workspaceId: j.workspaceId,
        jobFamily: j.jobFamily,
        schedule: j.schedule,
        params: j.params,
      }));
      const enqueued = await tick(defs, queue, { windowStart: lastTick, now });
      lastTick = now;
      await queue.drain();
      if (enqueued.length) rt.logger.info("worker: tick enqueued", { count: enqueued.length });
    } catch (err) {
      rt.logger.warn("worker: tick error", { error: err instanceof Error ? err.message : String(err) });
    }
  })();
}, 15_000);

// --- Banner --------------------------------------------------------------------
const base = `http://localhost:${PORT}`;
console.log(`
────────────────────────────────────────────────────────
  AI Growth OS — running locally (Web + API + Worker)
────────────────────────────────────────────────────────
  Dashboard    ${base}/
  Login        ${base}/login
  Connections  ${base}/connections
  Actions      ${base}/actions
  Health       ${base}/health
────────────────────────────────────────────────────────
  Demo login (offline, no email service):
    1. open ${base}/login
    2. enter:  ${rt.demo.email}
    3. a "🔑 SIGN-IN LINK" prints in THIS terminal — open it
       in the same browser to land on the dashboard.
  Workspace: ${rt.demo.workspaceName}
────────────────────────────────────────────────────────
`);

const shutdown = async () => {
  clearInterval(workerTimer);
  await new Promise<void>((r) => web.close(() => r()));
  await rt.stop();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
