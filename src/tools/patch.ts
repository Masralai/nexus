import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { dirname, resolve, join } from "node:path"
import type { Tool } from "../engine/types"

type PatchOp = { type: "add" | "update" | "move" | "delete"; path: string; content?: string; target?: string }

function parsePatch(text: string): PatchOp[] {
  const ops: PatchOp[] = []
  const lines = text.split("\n")
  let cur: PatchOp | null = null
  let buf: string[] = []
  const flush = () => {
    if (cur) {
      if (cur.type === "add" || cur.type === "update") cur.content = buf.join("\n")
      ops.push(cur)
    }
    cur = null
    buf = []
  }
  for (const line of lines) {
    if (line.startsWith("*** Add File: ")) {
      flush()
      cur = { type: "add", path: line.slice("*** Add File: ".length).trim() }
    } else if (line.startsWith("*** Update File: ")) {
      flush()
      cur = { type: "update", path: line.slice("*** Update File: ".length).trim() }
    } else if (line.startsWith("*** Move to: ")) {
      if (cur) cur.target = line.slice("*** Move to: ".length).trim()
      else cur = { type: "move", path: "", target: line.slice("*** Move to: ".length).trim() }
    } else if (line.startsWith("*** Delete File: ")) {
      flush()
      ops.push({ type: "delete", path: line.slice("*** Delete File: ".length).trim() })
    } else {
      if (cur) buf.push(line)
    }
  }
  flush()
  return ops
}

// Simple undo stack per cwd (in-memory)
const undoStack: Map<string, { path: string; prev: string | null }[]> = new Map()

function pushUndo(cwd: string, entry: { path: string; prev: string | null }) {
  const stack = undoStack.get(cwd) ?? []
  stack.push(entry)
  undoStack.set(cwd, stack)
}

export const apply_patch: Tool = {
  name: "apply_patch",
  description: "Apply patches to files. Input: { patchText }. Markers: *** Add File:, *** Update File:, *** Move to:, *** Delete File:",
  schema: {
    type: "object",
    properties: { patchText: { type: "string" } },
    required: ["patchText"],
  },
  readonly: false,
  async execute(input, ctx) {
    const { patchText } = input as { patchText: string }
    if (!patchText || typeof patchText !== "string") return { ok: false, output: "", error: "patchText required" }
    const ops = parsePatch(patchText)
    if (ops.length === 0) return { ok: false, output: "", error: "no patch operations found" }
    const out: string[] = []
    for (const op of ops) {
      try {
        const full = resolve(ctx.cwd, op.path)
        if (op.type === "add") {
          mkdirSync(dirname(full), { recursive: true })
          // save undo
          let prev: string | null = null
          try { prev = readFileSync(full, "utf8") } catch { prev = null }
          pushUndo(ctx.cwd, { path: op.path, prev })
          writeFileSync(full, op.content ?? "")
          out.push(`added ${op.path}`)
        } else if (op.type === "update") {
          let prev: string | null = null
          try { prev = readFileSync(full, "utf8") } catch { return { ok: false, output: "", error: `file not found: ${op.path}` } }
          pushUndo(ctx.cwd, { path: op.path, prev })
          mkdirSync(dirname(full), { recursive: true })
          writeFileSync(full, op.content ?? "")
          out.push(`updated ${op.path}`)
          if (op.target) {
            const targetFull = resolve(ctx.cwd, op.target)
            mkdirSync(dirname(targetFull), { recursive: true })
            // move after update
            try { writeFileSync(targetFull, readFileSync(full, "utf8")); unlinkSync(full) } catch {}
            out.push(`moved ${op.path} -> ${op.target}`)
          }
        } else if (op.type === "delete") {
          let prev: string | null = null
          try { prev = readFileSync(full, "utf8") } catch { prev = null }
          pushUndo(ctx.cwd, { path: op.path, prev })
          try { unlinkSync(full) } catch {}
          out.push(`deleted ${op.path}`)
        } else if (op.type === "move") {
          // pure move without content
          out.push(`move ${op.path} -> ${op.target}`)
        }
      } catch (e) {
        return { ok: false, output: out.join("\n"), error: e instanceof Error ? e.message : String(e) }
      }
    }
    return { ok: true, output: out.join("\n") }
  },
}

export function undoLast(cwd: string): { ok: boolean; output: string; error?: string } {
  const stack = undoStack.get(cwd)
  if (!stack || stack.length === 0) return { ok: false, output: "", error: "nothing to undo" }
  const last = stack.pop()!
  const full = resolve(cwd, last.path)
  try {
    if (last.prev === null) {
      try { unlinkSync(full) } catch {}
      return { ok: true, output: `undid ${last.path} (removed)` }
    }
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, last.prev)
    return { ok: true, output: `undid ${last.path}` }
  } catch (e) {
    return { ok: false, output: "", error: e instanceof Error ? e.message : String(e) }
  }
}

export function redoPlaceholder(): void {}
