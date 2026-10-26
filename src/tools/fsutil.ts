import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { dirname, resolve } from "node:path"
import type { SnapshotFile, ToolContext } from "../engine/types"

const locks = new Map<string, Promise<unknown>>()
const readVersions = new Map<string, string>()

export function rememberRead(path: string, content: string): void {
  readVersions.set(path, content)
}

export function checkFresh(path: string, content: string): string | undefined {
  const prior = readVersions.get(path)
  if (prior !== undefined && prior !== content) {
    return `${path} changed on disk since it was read; read it again before editing`
  }
  return undefined
}

export function forgetPath(path: string): void {
  readVersions.delete(path)
}

/** Serialize mutations to one path, even when tool calls are optimistically parallel. */
export async function withFileLock<T>(path: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = locks.get(path) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  locks.set(path, previous.then(() => gate))
  await previous
  try {
    return await fn()
  } finally {
    release()
    if (locks.get(path) === gate) locks.delete(path)
  }
}

export function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  let mode: number | undefined
  try {
    mode = statSync(path).mode
  } catch {
    /* new file */
  }
  const tmp = `${path}.nexus-tmp-${process.pid}-${randomUUID()}`
  writeFileSync(tmp, content, { mode: mode ?? 0o644 })
  if (mode !== undefined) {
    try {
      chmodSync(tmp, mode)
    } catch {
      /* best effort */
    }
  }
  renameSync(tmp, path)
}

export function snapshotPaths(ctx: ToolContext, label: string, paths: string[]): string | undefined {
  if (!ctx.snapshots || !ctx.sessionId) return undefined
  const files: SnapshotFile[] = []
  for (const item of paths) {
    const full = resolve(ctx.cwd, item)
    files.push({
      path: item,
      content: existsSync(full) ? readFileSync(full, "utf8") : null,
    })
  }
  return ctx.snapshots.saveSnapshot(ctx.sessionId, label, files)
}

export function restoreSnapshot(ctx: ToolContext, id?: string): { ok: boolean; output: string; error?: string } {
  if (!ctx.snapshots || !ctx.sessionId) return { ok: false, output: "", error: "snapshots unavailable" }
  const snaps = ctx.snapshots.listSnapshots?.(ctx.sessionId) ?? []
  const target = id ? ctx.snapshots.getSnapshot(ctx.sessionId, id) : undefined
  const chosen = target ?? (snaps[0] ? ctx.snapshots.getSnapshot(ctx.sessionId, snaps[0].id) : undefined)
  if (!chosen) return { ok: false, output: "", error: id ? `snapshot not found: ${id}` : "no snapshots" }
  const out: string[] = []
  for (const file of chosen.files) {
    const full = resolve(ctx.cwd, file.path)
    if (file.content === null) {
      try {
        if (existsSync(full)) unlinkSync(full)
      } catch {
        /* best effort */
      }
      out.push(`removed ${file.path}`)
    } else {
      atomicWrite(full, file.content)
      forgetPath(full)
      out.push(`restored ${file.path}`)
    }
  }
  return { ok: true, output: out.join("\n") }
}
