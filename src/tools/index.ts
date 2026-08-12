import { execSync } from "node:child_process"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import type { Tool } from "../engine/types"

export const READ_TOOLS = new Set(["read", "glob", "grep"])

const MAX_OUTPUT = 8000

function cap(text: string): string {
  return text.length <= MAX_OUTPUT ? text : `${text.slice(0, MAX_OUTPUT)}\n[...truncated ${text.length - MAX_OUTPUT} chars]`
}

export const read: Tool = {
  name: "read",
  description: "Read a file. Input: { path, offset?, limit? } where offset/limit are 0-based line numbers.",
  schema: {
    type: "object",
    properties: { path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } },
    required: ["path"],
  },
  async execute(input, ctx) {
    const { path, offset, limit } = input as { path: string; offset?: number; limit?: number }
    const lines = readFileSync(resolve(ctx.cwd, path), "utf8").replace(/\n$/, "").split("\n")
    const start = offset ?? 0
    const slice = lines.slice(start, limit === undefined ? undefined : start + limit)
    const header = offset === undefined ? "" : `[lines ${start}-${start + slice.length - 1} of ${lines.length}]\n`
    return { ok: true, output: header + slice.join("\n") }
  },
}

export const write: Tool = {
  name: "write",
  description: "Create or overwrite a file. Input: { path, content }.",
  schema: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  async execute(input, ctx) {
    const { path, content } = input as { path: string; content: string }
    if (!(await ctx.requirePermission(`write ${path}`))) return { ok: false, output: "", error: "permission denied" }
    writeFileSync(resolve(ctx.cwd, path), content)
    return { ok: true, output: `wrote ${path} (${content.length} bytes)` }
  },
}

export const edit: Tool = {
  name: "edit",
  description: "Replace the first occurrence of oldString with newString in a file. Input: { path, oldString, newString }.",
  schema: {
    type: "object",
    properties: { path: { type: "string" }, oldString: { type: "string" }, newString: { type: "string" } },
    required: ["path", "oldString", "newString"],
  },
  async execute(input, ctx) {
    const { path, oldString, newString } = input as { path: string; oldString: string; newString: string }
    if (!(await ctx.requirePermission(`edit ${path}`))) return { ok: false, output: "", error: "permission denied" }
    const full = resolve(ctx.cwd, path)
    const content = readFileSync(full, "utf8")
    if (!content.includes(oldString)) return { ok: false, output: "", error: "oldString not found" }
    writeFileSync(full, content.replace(oldString, newString))
    return { ok: true, output: `edited ${path}` }
  },
}

export const bash: Tool = {
  name: "bash",
  description: "Run a shell command in the working directory. Input: { command }.",
  schema: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
  async execute(input, ctx) {
    const { command } = input as { command: string }
    if (!(await ctx.requirePermission(command))) return { ok: false, output: "", error: "permission denied" }
    try {
      const stdout = execSync(command, { cwd: ctx.cwd, encoding: "utf8", timeout: 30_000 })
      return { ok: true, output: cap(stdout) }
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string }
      return { ok: false, output: cap(`${err.stdout ?? ""}${err.stderr ?? ""}`), error: err.message }
    }
  },
}

export const glob: Tool = {
  name: "glob",
  description: "Find files matching a glob pattern. Input: { pattern }.",
  schema: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
  async execute(input, ctx) {
    const { pattern } = input as { pattern: string }
    const matches = [...new Bun.Glob(pattern).scanSync({ cwd: ctx.cwd })]
    return { ok: true, output: cap(matches.join("\n")) }
  },
}

export const grep: Tool = {
  name: "grep",
  description: "Search file contents with a regex. Input: { pattern, path? }. Skips dotfiles and node_modules.",
  schema: {
    type: "object",
    properties: { pattern: { type: "string" }, path: { type: "string" } },
    required: ["pattern"],
  },
  async execute(input, ctx) {
    const { pattern, path } = input as { pattern: string; path?: string }
    const re = new RegExp(pattern)
    const root = path ? resolve(ctx.cwd, path) : ctx.cwd
    const hits: string[] = []
    walk(root, (file) => {
      let lines: string[]
      try {
        lines = readFileSync(file, "utf8").split("\n")
      } catch {
        return
      }
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) hits.push(`${relative(ctx.cwd, file)}:${i + 1}:${lines[i].slice(0, 200)}`)
      }
    })
    const head = hits.slice(0, 200)
    const more = hits.length > 200 ? `\n[...${hits.length - 200} more matches]` : ""
    return { ok: true, output: cap(head.join("\n") + more) }
  },
}

function walk(root: string, fn: (file: string) => void): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue
      walk(full, fn)
    } else fn(full)
  }
}

export function defaultTools(): Tool[] {
  return [read, write, edit, bash, glob, grep]
}