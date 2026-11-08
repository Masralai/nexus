import { execFileSync } from "node:child_process"
import type { Tool } from "../engine/types"

const MAX_OUTPUT = 16_000

function git(cwd: string, args: string[]): { ok: true; output: string } | { ok: false; output: string; error: string } {
  try {
    const output = execFileSync("git", ["--no-pager", ...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 4_000_000,
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { ok: true, output: output.length > MAX_OUTPUT ? `${output.slice(0, MAX_OUTPUT)}\n[...truncated]` : output }
  } catch (error) {
    const e = error as { stderr?: Buffer | string; message?: string }
    return {
      ok: false,
      output: "",
      error: String(e.stderr ?? e.message ?? error).trim() || "git failed",
    }
  }
}

function optionalPath(value: unknown): string[] {
  return typeof value === "string" && value.trim() ? ["--", value] : []
}

export const git_status: Tool = {
  name: "git_status",
  description: "Show the working tree and branch status. Read-only. Input: {}.",
  schema: { type: "object", properties: {} },
  readonly: true,
  outputLimit: 16_000,
  async execute(_input, ctx) {
    return git(ctx.cwd, ["status", "--short", "--branch"])
  },
}

export const git_diff: Tool = {
  name: "git_diff",
  description: "Show unstaged or staged changes. Read-only. Input: { staged?, path? }.",
  schema: {
    type: "object",
    properties: { staged: { type: "boolean" }, path: { type: "string" } },
  },
  readonly: true,
  outputLimit: 16_000,
  async execute(input, ctx) {
    const { staged, path } = (input ?? {}) as { staged?: boolean; path?: string }
    return git(ctx.cwd, ["diff", "--no-color", ...(staged ? ["--staged"] : []), ...optionalPath(path)])
  },
}

export const git_log: Tool = {
  name: "git_log",
  description: "Show recent commits. Read-only. Input: { limit?, path? }.",
  schema: {
    type: "object",
    properties: { limit: { type: "number" }, path: { type: "string" } },
  },
  readonly: true,
  outputLimit: 16_000,
  async execute(input, ctx) {
    const { limit, path } = (input ?? {}) as { limit?: number; path?: string }
    const count = Math.min(Math.max(1, Math.floor(limit ?? 20)), 200)
    return git(ctx.cwd, ["log", "--oneline", "--decorate", "-n", String(count), ...optionalPath(path)])
  },
}
