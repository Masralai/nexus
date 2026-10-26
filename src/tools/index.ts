import { execSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, dirname, relative, resolve } from "node:path"
import type { ImagePart, Tool, ToolContext, ToolResult } from "../engine/types"
import { getModelInfo } from "../providers/catalog"
import { apply_patch } from "./patch"
import { todowrite, todoread } from "./todo"
import { question } from "./question"
import { lsp } from "./lsp"
import { task } from "./task"
import { allFiles, displayPath, isBinaryLike } from "./walk"
import {
  atomicWrite,
  checkFresh,
  forgetPath,
  rememberRead,
  restoreSnapshot,
  snapshotPaths,
  withFileLock,
} from "./fsutil"

const MAX_OUTPUT = 8000
const MAX_IMAGE_BYTES = 8_000_000
const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
}

function cap(text: string, max = MAX_OUTPUT): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[...truncated ${text.length - max} chars]`
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function appendPostEdit(ctx: ToolContext, paths: string[], result: ToolResult): Promise<ToolResult> {
  if (!ctx.afterEdit || !result.ok) return result
  try {
    const notes = await ctx.afterEdit(paths)
    if (notes.length) return { ...result, output: `${result.output}\n${notes.join("\n")}` }
  } catch (e) {
    return { ...result, output: `${result.output}\n[formatter/diagnostics failed] ${errorText(e)}` }
  }
  return result
}

export const read: Tool = {
  name: "read",
  description:
    "Read a file. Input: { path, offset?, limit? } where offset/limit are 0-based line numbers. Image files are returned as image parts for vision models. To read N files, emit N parallel read calls — one path per call, not paths[] or _raw.",
  schema: {
    type: "object",
    properties: { path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } },
    required: ["path"],
  },
  readonly: true,
  outputLimit: 32_000,
  async execute(input, ctx) {
    const rawInput = input as Record<string, unknown>
    if (rawInput && typeof rawInput === "object" && "_raw" in rawInput) {
      return { ok: false, output: "", error: "Invalid read input: received _raw. Emit N separate read calls — one { path } per call — instead of batching." }
    }
    const { path, offset, limit } = input as { path: string; offset?: number; limit?: number }
    if (typeof path !== "string") {
      return { ok: false, output: "", error: "Invalid read input: missing required string field 'path'. Emit one { path } per read call." }
    }
    const full = resolve(ctx.cwd, path)
    try {
      const st = statSync(full)
      if (!st.isFile()) return { ok: false, output: "", error: `not a file: ${path}` }
      const mime = IMAGE_TYPES[full.slice(full.lastIndexOf(".")).toLowerCase()]
      if (mime) {
        if (offset !== undefined || limit !== undefined) {
          return { ok: false, output: "", error: "line windows are not available for images" }
        }
        if (st.size > MAX_IMAGE_BYTES) return { ok: false, output: "", error: `image too large (${st.size} bytes; max ${MAX_IMAGE_BYTES})` }
        const info = getModelInfo(ctx.model ?? "")
        if (!info.vision) {
          return {
            ok: false,
            output: "",
            error: `model ${ctx.model ?? "(unknown)"} does not support image input; choose a vision-capable catalog model`,
          }
        }
        const image: ImagePart = { mimeType: mime, data: readFileSync(full).toString("base64"), path }
        return { ok: true, output: `image ${path} (${mime}, ${st.size} bytes)`, images: [image] }
      }
      if (isBinaryLike(full, MAX_IMAGE_BYTES)) {
        return { ok: false, output: "", error: `binary file: ${path}` }
      }
      const raw = readFileSync(full, "utf8")
      rememberRead(full, raw)
      const lines = raw.replace(/\n$/, "").split("\n")
      const start = Math.max(0, offset ?? 0)
      const slice = lines.slice(start, limit === undefined ? undefined : start + Math.max(0, limit))
      const header = offset === undefined ? "" : `[lines ${start}-${Math.max(start, start + slice.length - 1)} of ${lines.length}]\n`
      return { ok: true, output: cap(header + slice.join("\n")) }
    } catch (e) {
      return { ok: false, output: "", error: errorText(e) }
    }
  },
}

export const write: Tool = {
  name: "write",
  description: "Create or atomically overwrite a file. Input: { path, content }. A snapshot is taken before mutation.",
  schema: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  readonly: false,
  outputLimit: 4_000,
  async execute(input, ctx) {
    const { path, content } = input as { path: string; content: string }
    if (typeof path !== "string" || typeof content !== "string") {
      return { ok: false, output: "", error: "write requires string fields path and content" }
    }
    const full = resolve(ctx.cwd, path)
    return withFileLock(full, async () => {
      try {
        let current: string | undefined
        if (existsSync(full)) current = readFileSync(full, "utf8")
        if (current !== undefined) {
          const stale = checkFresh(full, current)
          if (stale) return { ok: false, output: "", error: stale }
        }
        snapshotPaths(ctx, `write ${path}`, [path])
        atomicWrite(full, content)
        rememberRead(full, content)
        return appendPostEdit(ctx, [path], { ok: true, output: `wrote ${path} (${content.length} bytes)` })
      } catch (e) {
        return { ok: false, output: "", error: errorText(e) }
      }
    })
  },
}

export const edit: Tool = {
  name: "edit",
  description:
    "Replace text in a file. Input: { path, oldString, newString, replaceAll? }. Fails when oldString is absent, ambiguous (more than one match without replaceAll), or the file changed since it was read. Use apply_patch for multi-file/multi-occurrence refactors.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string" },
      oldString: { type: "string" },
      newString: { type: "string" },
      replaceAll: { type: "boolean" },
    },
    required: ["path", "oldString", "newString"],
  },
  readonly: false,
  outputLimit: 4_000,
  async execute(input, ctx) {
    const { path, oldString, newString, replaceAll } = input as {
      path: string
      oldString: string
      newString: string
      replaceAll?: boolean
    }
    if (typeof path !== "string" || typeof oldString !== "string" || typeof newString !== "string") {
      return { ok: false, output: "", error: "edit requires string fields path, oldString, newString" }
    }
    if (oldString.length === 0) return { ok: false, output: "", error: "oldString must not be empty" }
    if (oldString === newString) return { ok: false, output: "", error: "oldString and newString are identical" }
    const full = resolve(ctx.cwd, path)
    return withFileLock(full, async () => {
      try {
        const content = readFileSync(full, "utf8")
        const stale = checkFresh(full, content)
        if (stale) return { ok: false, output: "", error: stale }
        const count = content.split(oldString).length - 1
        if (count === 0) return { ok: false, output: "", error: "oldString not found" }
        if (count > 1 && !replaceAll) {
          return {
            ok: false,
            output: "",
            error: `oldString appears ${count} times; add more context or set replaceAll: true`,
          }
        }
        snapshotPaths(ctx, `edit ${path}`, [path])
        const next = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString)
        atomicWrite(full, next)
        rememberRead(full, next)
        return appendPostEdit(ctx, [path], {
          ok: true,
          output: `edited ${path} (${replaceAll ? count : 1} replacement${replaceAll && count !== 1 ? "s" : ""})`,
        })
      } catch (e) {
        return { ok: false, output: "", error: errorText(e) }
      }
    })
  },
}

export const bash: Tool = {
  name: "bash",
  description:
    "Run a shell command in a persistent PTY. Working directory and environment survive between calls. Input: { command, timeoutMs? }. Use job_start for long-running processes. Do not use for listing or reading files; use list, glob, read, grep.",
  schema: {
    type: "object",
    properties: { command: { type: "string" }, timeoutMs: { type: "number" } },
    required: ["command"],
  },
  readonly: false,
  outputLimit: 24_000,
  async execute(input, ctx) {
    const { command, timeoutMs } = input as { command: string; timeoutMs?: number }
    if (typeof command !== "string" || !command.trim()) return { ok: false, output: "", error: "command required" }
    try {
      if (ctx.pty) {
        const result = await ctx.pty.run(ctx.sessionId ?? ctx.cwd, command, {
          cwd: ctx.cwd,
          timeoutMs: timeoutMs ?? 30_000,
          onOutput: ctx.onOutput,
        })
        if (result.exitCode !== 0) {
          return { ok: false, output: cap(result.output), error: `exit code ${result.exitCode}` }
        }
        return { ok: true, output: cap(result.output) }
      }
      try {
        const stdout = execSync(command, { cwd: ctx.cwd, encoding: "utf8", timeout: timeoutMs ?? 30_000 })
        return { ok: true, output: cap(stdout) }
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string; message?: string }
        return { ok: false, output: cap(`${err.stdout ?? ""}${err.stderr ?? ""}`), error: err.message }
      }
    } catch (e) {
      return { ok: false, output: "", error: errorText(e) }
    }
  },
}

export const list: Tool = {
  name: "list",
  description:
    "List files and directories in a path. Prefer this over bash ls. Input: { path? }. For multiple directories, emit N parallel list calls.",
  schema: { type: "object", properties: { path: { type: "string" } } },
  readonly: true,
  outputLimit: 16_000,
  async execute(input, ctx) {
    const { path } = (input ?? {}) as { path?: string }
    const dir = resolve(ctx.cwd, path ?? ".")
    try {
      const lines = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.name !== ".git")
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
      return { ok: true, output: cap(lines.join("\n")) }
    } catch (e) {
      return { ok: false, output: "", error: errorText(e) }
    }
  },
}

export const glob: Tool = {
  name: "glob",
  description:
    "Find files matching a glob pattern. Input: { pattern, includeHidden? }. Uses git's tracked/untracked file set so .gitignore applies to glob, grep and list consistently. For multiple patterns, emit N parallel glob calls.",
  schema: {
    type: "object",
    properties: { pattern: { type: "string" }, includeHidden: { type: "boolean" } },
    required: ["pattern"],
  },
  readonly: true,
  outputLimit: 8_000,
  async execute(input, ctx) {
    const { pattern, includeHidden } = input as { pattern: string; includeHidden?: boolean }
    if (typeof pattern !== "string" || !pattern) return { ok: false, output: "", error: "pattern required" }
    try {
      const files = allFiles(ctx.cwd, { includeHidden })
      if (files.length > 0 || existsSync(resolve(ctx.cwd, ".git"))) {
        let matches: string[]
        try {
          // @ts-expect-error Bun.Glob is provided by the Bun runtime types.
          const matcher = new Bun.Glob(pattern)
          matches = files.filter((f) => matcher.match(f))
        } catch {
          const fg = await import("fast-glob")
          matches = await fg.default(pattern, { cwd: ctx.cwd, dot: false, onlyFiles: true })
        }
        return { ok: true, output: cap(matches.sort().join("\n")) }
      }
      const fg = await import("fast-glob")
      const entries = await fg.default(pattern, {
        cwd: ctx.cwd,
        dot: false,
        onlyFiles: true,
        ignore: ["**/node_modules/**", "**/.git/**", "**/.next/**", "**/dist/**"],
      })
      return { ok: true, output: cap((entries as string[]).sort().join("\n")) }
    } catch (e) {
      return { ok: false, output: "", error: errorText(e) }
    }
  },
}

function hasRipgrep(): boolean {
  try {
    return Bun.spawnSync(["rg", "--version"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0
  } catch {
    return false
  }
}

export const grep: Tool = {
  name: "grep",
  description:
    "Search file contents with a regex using ripgrep when available. Input: { pattern, path?, glob?, includeHidden? }. Respects .gitignore. For multiple searches, emit N parallel grep calls.",
  schema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string" },
      glob: { type: "string" },
      includeHidden: { type: "boolean" },
    },
    required: ["pattern"],
  },
  readonly: true,
  outputLimit: 16_000,
  async execute(input, ctx) {
    const { pattern, path, glob: fileGlob, includeHidden } = input as {
      pattern: string
      path?: string
      glob?: string
      includeHidden?: boolean
    }
    if (typeof pattern !== "string" || !pattern) return { ok: false, output: "", error: "pattern required" }
    const root = path ? resolve(ctx.cwd, path) : ctx.cwd
    if (hasRipgrep()) {
      const args = ["--line-number", "--no-heading", "--color", "never", "--max-columns", "500", "--max-count", "200"]
      if (includeHidden) args.push("--hidden")
      if (fileGlob) args.push("--glob", fileGlob)
      args.push(pattern, root)
      try {
        const proc = Bun.spawnSync(["rg", ...args], { cwd: ctx.cwd, stdout: "pipe", stderr: "pipe" })
        if (proc.exitCode === 0 || proc.exitCode === 1) {
          const text = proc.stdout.toString().split("\n").filter(Boolean).slice(0, 200).map((line) => {
            const abs = line.slice(0, line.indexOf(":"))
            return displayPath(ctx.cwd, abs) + line.slice(abs.length)
          })
          return { ok: true, output: cap(text.join("\n")) }
        }
        if (proc.exitCode > 1) return { ok: false, output: "", error: proc.stderr.toString() || `rg exit ${proc.exitCode}` }
      } catch (e) {
        return { ok: false, output: "", error: errorText(e) }
      }
    }

    let re: RegExp
    try {
      re = new RegExp(pattern)
    } catch (e) {
      return { ok: false, output: "", error: errorText(e) }
    }
    const hits: string[] = []
    const maxHits = 200
    let truncated = false
    const files = path && statSync(root).isFile() ? [relative(ctx.cwd, root)] : allFiles(ctx.cwd, { includeHidden })
    for (const file of files) {
      if (hits.length >= maxHits + 1) {
        truncated = true
        break
      }
      const full = resolve(ctx.cwd, file)
      if (!full.startsWith(root) && !(path && full === root)) continue
      if (isBinaryLike(full)) continue
      let lines: string[]
      try {
        lines = readFileSync(full, "utf8").split("\n")
      } catch {
        continue
      }
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0
        if (re.test(lines[i])) {
          hits.push(`${displayPath(ctx.cwd, full)}:${i + 1}:${lines[i].slice(0, 500)}`)
          if (hits.length > maxHits) {
            truncated = true
            break
          }
        }
      }
    }
    const head = hits.slice(0, maxHits)
    const more = truncated || hits.length > maxHits ? `\n[...more matches — results truncated at ${maxHits}, refine pattern or path]` : ""
    return { ok: true, output: cap(head.join("\n") + more) }
  },
}

export const undo: Tool = {
  name: "undo",
  description: "Revert the most recent file snapshot, or a specific snapshot id. Input: { snapshotId? }",
  schema: { type: "object", properties: { snapshotId: { type: "string" } } },
  readonly: false,
  outputLimit: 4_000,
  async execute(input, ctx) {
    const { snapshotId } = (input ?? {}) as { snapshotId?: string }
    return restoreSnapshot(ctx, snapshotId)
  },
}

export const snapshots: Tool = {
  name: "snapshots",
  description: "List or restore durable file snapshots for this Session. Input: { action: 'list'|'restore', id? }",
  schema: {
    type: "object",
    properties: { action: { type: "string" }, id: { type: "string" } },
    required: ["action"],
  },
  readonly: false,
  async execute(input, ctx) {
    const { action, id } = input as { action: string; id?: string }
    if (action === "restore") return restoreSnapshot(ctx, id)
    const items = ctx.snapshots?.listSnapshots?.(ctx.sessionId ?? "") ?? []
    return { ok: true, output: items.map((s) => `${s.id} ${s.createdAt} ${s.label}`).join("\n") || "no snapshots" }
  },
}

export { apply_patch } from "./patch"
export { todowrite, todoread } from "./todo"
export { question } from "./question"
export { lsp } from "./lsp"
export { task } from "./task"

export function defaultTools(): Tool[] {
  return [read, write, edit, bash, glob, grep, list, apply_patch, undo, snapshots, todowrite, todoread, question, lsp, task]
}

/** @deprecated Prefer tool.readonly / isReadonlyTool — kept for any external imports. */
export const READ_TOOLS = new Set(defaultTools().filter((t) => t.readonly).map((t) => t.name))
