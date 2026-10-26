import { existsSync, readFileSync, unlinkSync } from "node:fs"
import { resolve } from "node:path"
import type { Tool, ToolContext } from "../engine/types"
import { atomicWrite, checkFresh, forgetPath, snapshotPaths, withFileLock } from "./fsutil"

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
    } else if (line === "*** Begin Patch" || line === "*** End Patch") {
      continue
    } else if (cur) {
      buf.push(line)
    }
  }
  flush()
  return ops
}

async function post(ctx: ToolContext, paths: string[], out: string[]): Promise<string[]> {
  if (!ctx.afterEdit || paths.length === 0) return out
  try {
    out.push(...(await ctx.afterEdit(paths)))
  } catch {
    /* reported by the caller's edit tool; patch keeps its primary result */
  }
  return out
}

export const apply_patch: Tool = {
  name: "apply_patch",
  description:
    "Apply a multi-file patch atomically per file. Input: { patchText }. Markers: *** Add File:, *** Update File:, *** Move to:, *** Delete File:, wrapped by *** Begin Patch / *** End Patch. Snapshots are taken before mutation.",
  schema: {
    type: "object",
    properties: { patchText: { type: "string" } },
    required: ["patchText"],
  },
  readonly: false,
  outputLimit: 8_000,
  async execute(input, ctx) {
    const { patchText } = input as { patchText: string }
    if (!patchText || typeof patchText !== "string") return { ok: false, output: "", error: "patchText required" }
    const ops = parsePatch(patchText)
    if (ops.length === 0) return { ok: false, output: "", error: "no patch operations found" }
    // Validate all paths and operations before touching a single file.
    for (const op of ops) {
      if (!op.path && op.type !== "move") return { ok: false, output: "", error: `${op.type} operation has no path` }
      if ((op.type === "update" || op.type === "delete") && op.path && !existsSync(resolve(ctx.cwd, op.path))) {
        return { ok: false, output: "", error: `file not found: ${op.path}` }
      }
    }
    const out: string[] = []
    const changed: string[] = []
    for (const op of ops) {
      const full = resolve(ctx.cwd, op.path)
      try {
        await withFileLock(full, async () => {
          if (op.type === "add") {
            if (existsSync(full)) throw new Error(`file already exists: ${op.path}`)
            snapshotPaths(ctx, `patch add ${op.path}`, [op.path])
            atomicWrite(full, op.content ?? "")
            changed.push(op.path)
            out.push(`added ${op.path}`)
          } else if (op.type === "update") {
            const current = readFileSync(full, "utf8")
            const stale = checkFresh(full, current)
            if (stale) throw new Error(stale)
            snapshotPaths(ctx, `patch update ${op.path}`, [op.path, ...(op.target ? [op.target] : [])])
            atomicWrite(full, op.content ?? "")
            forgetPath(full)
            changed.push(op.path)
            out.push(`updated ${op.path}`)
            if (op.target) {
              const targetFull = resolve(ctx.cwd, op.target)
              atomicWrite(targetFull, op.content ?? "")
              unlinkSync(full)
              changed.push(op.target)
              out.push(`moved ${op.path} -> ${op.target}`)
            }
          } else if (op.type === "delete") {
            snapshotPaths(ctx, `patch delete ${op.path}`, [op.path])
            unlinkSync(full)
            forgetPath(full)
            changed.push(op.path)
            out.push(`deleted ${op.path}`)
          } else if (op.type === "move") {
            if (!op.path || !op.target) throw new Error("move requires source and target")
            if (!existsSync(full)) throw new Error(`file not found: ${op.path}`)
            const targetFull = resolve(ctx.cwd, op.target)
            snapshotPaths(ctx, `patch move ${op.path}`, [op.path, op.target])
            atomicWrite(targetFull, readFileSync(full, "utf8"))
            unlinkSync(full)
            changed.push(op.path, op.target)
            out.push(`moved ${op.path} -> ${op.target}`)
          }
        })
      } catch (e) {
        return { ok: false, output: out.join("\n"), error: e instanceof Error ? e.message : String(e) }
      }
    }
    return { ok: true, output: (await post(ctx, changed, out)).join("\n") }
  },
}

/** Kept for API compatibility. Snapshots are the durable undo mechanism now. */
export function undoLast(_cwd: string): { ok: boolean; output: string; error?: string } {
  return { ok: false, output: "", error: "use the undo tool with a Session snapshot store" }
}
