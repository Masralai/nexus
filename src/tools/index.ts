import { execSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import type { Tool } from "../engine/types"
import { apply_patch, undoLast } from "./patch"
import { todowrite, todoread } from "./todo"
import { question } from "./question"
import { lsp } from "./lsp"
import { task } from "./task"

const MAX_OUTPUT = 8000

function cap(text: string): string {
  return text.length <= MAX_OUTPUT ? text : `${text.slice(0, MAX_OUTPUT)}\n[...truncated ${text.length - MAX_OUTPUT} chars]`
}

export const read: Tool = {
  name: "read",
  description: "Read a file. Input: { path, offset?, limit? } where offset/limit are 0-based line numbers. To read N files, emit N parallel read calls — one path per call, not paths[] or _raw.",
  schema: {
    type: "object",
    properties: { path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } },
    required: ["path"],
  },
  readonly: true,
  async execute(input, ctx) {
    const rawInput = input as Record<string, unknown>
    if (rawInput && typeof rawInput === "object" && "_raw" in rawInput) {
      return { ok: false, output: "", error: "Invalid read input: received _raw. Emit N separate read calls — one { path } per call — instead of batching." }
    }
    const { path, offset, limit } = input as { path: string; offset?: number; limit?: number }
    if (typeof path !== "string") {
      return { ok: false, output: "", error: "Invalid read input: missing required string field 'path'. Emit one { path } per read call." }
    }
    try {
      const raw = readFileSync(resolve(ctx.cwd, path), "utf8")
      const lines = raw.replace(/\n$/, "").split("\n")
      const start = offset ?? 0
      const slice = lines.slice(start, limit === undefined ? undefined : start + limit)
      const header = offset === undefined ? "" : `[lines ${start}-${start + slice.length - 1} of ${lines.length}]\n`
      const out = header + slice.join("\n")
      return { ok: true, output: cap(out) }
    } catch (e) {
      return { ok: false, output: "", error: e instanceof Error ? e.message : String(e) }
    }
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
  readonly: false,
  async execute(input, ctx) {
    const { path, content } = input as { path: string; content: string }
    const full = resolve(ctx.cwd, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
    return { ok: true, output: `wrote ${path} (${content.length} bytes)` }
  },
}

export const edit: Tool = {
  name: "edit",
  description: "Replace the first occurrence of oldString with newString in a file. Input: { path, oldString, newString }. Use apply_patch for multi-file or multi-occurrence edits.",
  schema: {
    type: "object",
    properties: { path: { type: "string" }, oldString: { type: "string" }, newString: { type: "string" } },
    required: ["path", "oldString", "newString"],
  },
  readonly: false,
  async execute(input, ctx) {
    const { path, oldString, newString } = input as { path: string; oldString: string; newString: string }
    const full = resolve(ctx.cwd, path)
    try {
      const content = readFileSync(full, "utf8")
      if (!content.includes(oldString)) return { ok: false, output: "", error: "oldString not found" }
      writeFileSync(full, content.replace(oldString, newString))
      return { ok: true, output: `edited ${path}` }
    } catch (e) {
      return { ok: false, output: "", error: e instanceof Error ? e.message : String(e) }
    }
  },
}

export const bash: Tool = {
  name: "bash",
  description:
    "Run a shell command in the working directory. Do not use for listing or reading files; use list, glob, read, grep. Input: { command }.",
  schema: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
  readonly: false,
  async execute(input, ctx) {
    const { command } = input as { command: string }
    try {
      const stdout = execSync(command, { cwd: ctx.cwd, encoding: "utf8", timeout: 30_000 })
      return { ok: true, output: cap(stdout) }
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string }
      return { ok: false, output: cap(`${err.stdout ?? ""}${err.stderr ?? ""}`), error: err.message }
    }
  },
}

export const list: Tool = {
  name: "list",
  description:
    "List files and directories in a path. Prefer this over bash ls. Input: { path? }. For multiple directories, emit N parallel list calls.",
  schema: { type: "object", properties: { path: { type: "string" } } },
  readonly: true,
  async execute(input, ctx) {
    const { path } = (input ?? {}) as { path?: string }
    const dir = resolve(ctx.cwd, path ?? ".")
    try {
      const lines = readdirSync(dir, { withFileTypes: true })
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
      return { ok: true, output: cap(lines.join("\n")) }
    } catch (e) {
      return { ok: false, output: "", error: e instanceof Error ? e.message : String(e) }
    }
  },
}

export const glob: Tool = {
  name: "glob",
  description:
    "Find files matching a glob pattern. Input: { pattern }. Respects .gitignore; use ! in .ignore to un-ignore. For multiple patterns, emit N parallel glob calls.",
  schema: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
  readonly: true,
  async execute(input, ctx) {
    const { pattern } = input as { pattern: string }
    try {
      // Prefer portable fast-glob; fallback to Bun.Glob if available
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyGlobal = globalThis as any
      if (anyGlobal.Bun?.Glob) {
        try {
          const matches = [...new anyGlobal.Bun.Glob(pattern).scanSync({ cwd: ctx.cwd })]
          return { ok: true, output: cap(matches.join("\n")) }
        } catch {
          // fall through to fast-glob
        }
      }
      const fg = await import("fast-glob")
      const entries = await fg.default(pattern, {
        cwd: ctx.cwd,
        dot: false,
        onlyFiles: true,
        ignore: ["**/node_modules/**", "**/.git/**", "**/.next/**", "**/dist/**"],
      })
      const sorted = (entries as string[]).sort()
      return { ok: true, output: cap(sorted.join("\n")) }
    } catch (e) {
      return { ok: false, output: "", error: e instanceof Error ? e.message : String(e) }
    }
  },
}

export const grep: Tool = {
  name: "grep",
  description:
    "Search file contents with a regex. Input: { pattern, path? }. Respects .gitignore; skips node_modules/.git/.next/dist. For multiple searches, emit N parallel grep calls.",
  schema: {
    type: "object",
    properties: { pattern: { type: "string" }, path: { type: "string" } },
    required: ["pattern"],
  },
  readonly: true,
  async execute(input, ctx) {
    const { pattern, path } = input as { pattern: string; path?: string }
    let re: RegExp
    try {
      re = new RegExp(pattern)
    } catch (e) {
      return { ok: false, output: "", error: e instanceof Error ? e.message : String(e) }
    }
    const root = path ? resolve(ctx.cwd, path) : ctx.cwd
    const hits: string[] = []
    const maxHits = 200
    let truncated = false
    walk(root, (file) => {
      if (hits.length >= maxHits + 1) {
        truncated = true
        return
      }
      // ignore binary / huge files quickly
      let lines: string[]
      try {
        const content = readFileSync(file, "utf8")
        if (content.length > 500_000) return
        lines = content.split("\n")
      } catch {
        return
      }
      for (let i = 0; i < lines.length; i++) {
        // avoid RegExp global lastIndex issues
        re.lastIndex = 0
        if (re.test(lines[i])) {
          hits.push(`${relative(ctx.cwd, file)}:${i + 1}:${lines[i].slice(0, 200)}`)
          if (hits.length > maxHits) {
            truncated = true
            break
          }
        }
      }
    })
    const head = hits.slice(0, maxHits)
    let more = ""
    if (truncated || hits.length > maxHits) {
      const extra = hits.length - maxHits
      more = `\n[...${extra} more matches — results truncated at ${maxHits}, refine pattern or path]`
    }
    const out = head.join("\n") + more
    if (head.length === 0) return { ok: true, output: "" }
    return { ok: true, output: cap(out) }
  },
}

function walk(root: string, fn: (file: string) => void): void {
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(root, { withFileTypes: true }) as unknown as ReturnType<typeof readdirSync>
  } catch {
    return
  }
  for (const entry of entries as unknown as { name: string; isDirectory: () => boolean }[]) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next" || entry.name === "dist") continue
      walk(full, fn)
    } else {
      if (entry.name.startsWith(".")) continue
      fn(full)
    }
  }
}

export { apply_patch } from "./patch"
export { todowrite, todoread } from "./todo"
export { question } from "./question"
export { lsp } from "./lsp"

export const undo: Tool = {
  name: "undo",
  description: "Undo last write/edit/apply_patch. Input: {}",
  schema: { type: "object", properties: {} },
  readonly: false,
  async execute(_input, ctx) {
    const r = undoLast(ctx.cwd)
    return r.ok ? { ok: true, output: r.output } : { ok: false, output: "", error: r.error }
  },
}

export function defaultTools(): Tool[] {
  return [read, write, edit, bash, glob, grep, list, apply_patch, undo, todowrite, todoread, question, lsp, task]
}

/** @deprecated Prefer tool.readonly / isReadonlyTool — kept for any external imports. */
export const READ_TOOLS = new Set(defaultTools().filter((t) => t.readonly).map((t) => t.name))
