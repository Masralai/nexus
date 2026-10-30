import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SQLiteStore } from "../../src/engine/sqlite"
import type { ToolContext } from "../../src/engine/types"
import { JobManager } from "../../src/runtime/jobs"
import { inbox, job_kill, job_list, job_start, job_status } from "../../src/tools/jobs"

function setup(): { dir: string; store: SQLiteStore; jobs: JobManager; ctx: ToolContext } {
  const dir = mkdtempSync(join(tmpdir(), "nexus-jobs-"))
  const store = new SQLiteStore({ path: join(dir, "state", "nexus.db") })
  const jobs = new JobManager(store)
  return { dir, store, jobs, ctx: { cwd: dir, sessionId: "ses_jobs", jobs } }
}

async function waitForDone(jobs: JobManager, id: string, timeout = 5_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const job = jobs.get(id)
    if (job && job.status !== "running") return
    await Bun.sleep(20)
  }
  throw new Error("timed out waiting for job")
}

test("job_start runs in the background and delivers output to the inbox", async () => {
  const { dir, store, jobs, ctx } = setup()
  try {
    const started = await job_start.execute({ command: "echo job-ok" }, ctx)
    expect(started.ok).toBe(true)
    const id = started.output.split(" ")[1]
    await waitForDone(jobs, id)

    const status = await job_status.execute({ id }, ctx)
    expect(status.ok).toBe(true)
    expect(status.output).toContain("done")
    expect(status.output).toContain("job-ok")

    const listed = await job_list.execute({}, ctx)
    expect(listed.output).toContain(id)

    const delivered = await inbox.execute({}, ctx)
    expect(delivered.ok).toBe(true)
    expect(delivered.output).toContain("job-ok")
  } finally {
    jobs.close()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("job_kill stops a running job", async () => {
  const { dir, store, jobs, ctx } = setup()
  try {
    const started = await job_start.execute({ command: "sleep 30" }, ctx)
    const id = started.output.split(" ")[1]
    const killed = await job_kill.execute({ id }, ctx)
    expect(killed.ok).toBe(true)
    await waitForDone(jobs, id)
    expect(jobs.get(id)?.status).not.toBe("running")
  } finally {
    jobs.close()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("job tools report a clear error without a runtime", async () => {
  const result = await job_start.execute({ command: "echo hi" }, { cwd: "/" })
  expect(result).toEqual({ ok: false, output: "", error: "background jobs unavailable in this runtime" })
})
