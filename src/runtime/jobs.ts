import { randomUUID } from "node:crypto"
import type { SQLiteStore } from "../engine/sqlite"
import type { JobControl, JobInfo } from "../engine/types"

const MAX_CAPTURE = 200_000

interface RunningJob {
  proc: ReturnType<typeof Bun.spawn>
  output: string
}

/**
 * Background jobs survive between tool calls. Results are written to the
 * Session inbox so the model can pick them up later, even after a restart.
 */
export class JobManager implements JobControl {
  private running = new Map<string, RunningJob>()

  constructor(private readonly store: SQLiteStore) {}

  async start(
    sessionId: string,
    command: string,
    opts: { cwd?: string; env?: Record<string, string> } = {},
  ): Promise<JobInfo> {
    const id = `job_${randomUUID()}`
    const startedAt = new Date().toISOString()
    this.store.createJob({ id, sessionId, command, status: "running", startedAt })
    const proc = Bun.spawn(["bash", "-lc", command], {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, ...opts.env },
      stdout: "pipe",
      stderr: "pipe",
    })
    const job: RunningJob = { proc, output: "" }
    this.running.set(id, job)

    const collect = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        const text = decoder.decode(value, { stream: true })
        if (job.output.length < MAX_CAPTURE) job.output += text
      }
    }
    void Promise.all([collect(proc.stdout), collect(proc.stderr)]).then(async () => {
      const exit = await proc.exited
      const status = exit === 0 ? "done" : "error"
      const endedAt = new Date().toISOString()
      this.store.updateJob(id, { status, output: job.output, exitCode: exit, endedAt })
      this.running.delete(id)
      this.store.addInbox(sessionId, {
        type: "job",
        id,
        command,
        status,
        exitCode: exit,
        output: job.output.slice(0, 20_000),
      })
    })

    return {
      id,
      sessionId,
      command,
      status: "running",
      output: "",
      startedAt,
    }
  }

  private info(id: string): JobInfo | undefined {
    const row = this.store.getJob(id)
    if (!row) return undefined
    const running = this.running.get(id)
    return {
      id: row.id,
      sessionId: row.sessionId,
      command: row.command,
      status: (row.status as JobInfo["status"]) ?? "running",
      output: row.output + (running?.output.slice(row.output.length) ?? ""),
      exitCode: row.exitCode,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    }
  }

  get(id: string): JobInfo | undefined {
    return this.info(id)
  }

  list(sessionId?: string): JobInfo[] {
    return this.store.listJobs(sessionId).map((j) => this.info(j.id)!).filter(Boolean)
  }

  kill(id: string): boolean {
    const running = this.running.get(id)
    if (!running) return false
    try {
      running.proc.kill()
    } catch {
      return false
    }
    return true
  }

  close(): void {
    for (const [id, job] of this.running) {
      try {
        job.proc.kill()
      } catch {
        /* ignore */
      }
      this.running.delete(id)
    }
  }
}
