import { resolve } from "node:path"
import type { Tool } from "../engine/types"

const MAX_OUTPUT = 12_000

function cap(text: string): string {
  return text.length <= MAX_OUTPUT ? text : `${text.slice(0, MAX_OUTPUT)}\n[...truncated ${text.length - MAX_OUTPUT} chars]`
}

function unavailable(): { ok: false; output: string; error: string } {
  return { ok: false, output: "", error: "background jobs unavailable in this runtime" }
}

function key(ctx: { sessionId?: string; cwd: string }): string {
  return ctx.sessionId ?? `cwd:${ctx.cwd}`
}

export const job_start: Tool = {
  name: "job_start",
  description:
    "Start a long-running command in the background so it does not block the Turn. Input: { command, cwd? }. Results are delivered to the Session inbox when the process exits. Use job_status or inbox to read output.",
  schema: {
    type: "object",
    properties: { command: { type: "string" }, cwd: { type: "string" } },
    required: ["command"],
  },
  readonly: false,
  outputLimit: 2_000,
  async execute(input, ctx) {
    if (!ctx.jobs) return unavailable()
    const { command, cwd } = input as { command?: string; cwd?: string }
    if (typeof command !== "string" || !command.trim()) {
      return { ok: false, output: "", error: "job_start requires a non-empty command" }
    }
    try {
      const info = await ctx.jobs.start(key(ctx), command, {
        cwd: cwd ? resolve(ctx.cwd, cwd) : ctx.cwd,
      })
      return {
        ok: true,
        output: `started ${info.id} in ${info.sessionId === key(ctx) ? "this session" : info.sessionId}: ${command}\nUse job_status with id ${info.id}, or inbox when it finishes.`,
      }
    } catch (e) {
      return { ok: false, output: "", error: e instanceof Error ? e.message : String(e) }
    }
  },
}

export const job_status: Tool = {
  name: "job_status",
  description: "Read one background job by id. Input: { id }.",
  schema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  readonly: true,
  outputLimit: 12_000,
  async execute(input, ctx) {
    if (!ctx.jobs) return unavailable()
    const { id } = input as { id?: string }
    if (typeof id !== "string" || !id) return { ok: false, output: "", error: "job_status requires an id" }
    const job = ctx.jobs.get(id)
    if (!job) return { ok: false, output: "", error: `job not found: ${id}` }
    const header = `${job.id} ${job.status}${job.exitCode === undefined ? "" : ` exit=${job.exitCode}`} started=${job.startedAt}${job.endedAt ? ` ended=${job.endedAt}` : ""}\n${job.command}`
    return { ok: true, output: cap(`${header}\n\n${job.output}`) }
  },
}

export const job_list: Tool = {
  name: "job_list",
  description: "List background jobs for this Session. Input: {}.",
  schema: { type: "object", properties: {} },
  readonly: true,
  outputLimit: 4_000,
  async execute(_input, ctx) {
    if (!ctx.jobs) return unavailable()
    const jobs = ctx.jobs.list(key(ctx))
    if (jobs.length === 0) return { ok: true, output: "no jobs" }
    return {
      ok: true,
      output: cap(
        jobs
          .map(
            (job) =>
              `${job.id} ${job.status}${job.exitCode === undefined ? "" : ` exit=${job.exitCode}`} ${job.command}`,
          )
          .join("\n"),
      ),
    }
  },
}

export const job_kill: Tool = {
  name: "job_kill",
  description: "Stop a running background job. Input: { id }.",
  schema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  readonly: false,
  outputLimit: 1_000,
  async execute(input, ctx) {
    if (!ctx.jobs) return unavailable()
    const { id } = input as { id?: string }
    if (typeof id !== "string" || !id) return { ok: false, output: "", error: "job_kill requires an id" }
    return ctx.jobs.kill(id)
      ? { ok: true, output: `killed ${id}` }
      : { ok: false, output: "", error: `job not running: ${id}` }
  },
}

export const inbox: Tool = {
  name: "inbox",
  description:
    "Read completed background work delivered to this Session (finished jobs and their output). Input: {}.",
  schema: { type: "object", properties: {} },
  readonly: true,
  outputLimit: 12_000,
  async execute(_input, ctx) {
    if (!ctx.jobs) return unavailable()
    const items = ctx.jobs.inbox(key(ctx))
    if (items.length === 0) return { ok: true, output: "inbox empty" }
    return {
      ok: true,
      output: cap(
        items
          .map((item) => {
            const data = item.data as { id?: string; command?: string; status?: string; exitCode?: number; output?: string }
            return `[${item.createdAt}] ${data.id ?? item.id} ${data.status ?? "done"}${data.exitCode === undefined ? "" : ` exit=${data.exitCode}`} ${data.command ?? ""}\n${data.output ?? ""}`
          })
          .join("\n\n"),
      ),
    }
  },
}
