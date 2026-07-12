/** scheduled_jobs — migration applies, reader returns enabled system jobs only. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listEnabledSystemJobs } from "../src/repositories/scheduled-jobs.js";
import { startHarness, type Harness } from "./harness.js";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
  await h.admin.query(
    `INSERT INTO scheduled_jobs (job_family, schedule, params) VALUES
     ('canary.spine', '0 6 * * *', '{}'),
     ('disabled.job', '0 7 * * *', '{}')`,
  );
  await h.admin.query(`UPDATE scheduled_jobs SET enabled = false WHERE job_family = 'disabled.job'`);
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe("scheduled_jobs reader", () => {
  it("returns enabled system definitions only", async () => {
    const jobs = await listEnabledSystemJobs(h.app);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ jobFamily: "canary.spine", schedule: "0 6 * * *", workspaceId: null });
  });
});
