import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type {
  LoadedSession,
  Message,
  SessionMeta,
  SessionStatus,
} from "./types"
import { sessionDisplayTitle } from "./title"

export { sessionDisplayTitle, sessionTitle } from "./title"

type Line =
  | { type: "meta"; session: SessionMeta }
  | { type: "msg"; msg: Message }
  | { type: "status"; status: SessionStatus }

/**
 * Legacy JSONL persistence, used only by the migration importer and its tests.
 * The product session store is `SQLiteStore`; JSONL is read-only after import.
 */
export class JSONLStore {
  constructor(readonly dir: string = join(homedir(), ".nexus", "sessions")) {}

  path(id: string): string {
    return join(this.dir, `${id}.jsonl`)
  }

  create(meta: SessionMeta, messages: Message[] = []): void {
    mkdirSync(this.dir, { recursive: true })
    appendFileSync(this.path(meta.id), JSON.stringify({ type: "meta", session: meta }) + "\n")
    for (const m of messages) this.append(meta.id, m)
  }

  append(id: string, msg: Message): void {
    appendFileSync(this.path(id), JSON.stringify({ type: "msg", msg }) + "\n")
  }

  setStatus(id: string, status: SessionStatus): void {
    appendFileSync(this.path(id), JSON.stringify({ type: "status", status }) + "\n")
  }

  load(id: string): LoadedSession {
    const lines = readFileSync(this.path(id), "utf8").split("\n").filter((l) => l.length > 0)
    if (lines.length === 0) throw new Error(`session ${id}: empty`)
    const first = JSON.parse(lines[0]) as Line
    if (first.type !== "meta") throw new Error(`session ${id}: first line is not meta`)
    const messages: Message[] = []
    let status: SessionStatus = "running"
    for (const line of lines.slice(1)) {
      const rec = JSON.parse(line) as Line
      if (rec.type === "msg") messages.push(rec.msg)
      else if (rec.type === "status") status = rec.status
    }
    return { meta: first.session, status, messages }
  }

  list(): SessionMeta[] {
    try {
      mkdirSync(this.dir, { recursive: true })
      return readdirSync(this.dir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => {
          try {
            return this.load(f.replace(/\.jsonl$/, "")).meta
          } catch {
            return null
          }
        })
        .filter((m): m is SessionMeta => m !== null)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    } catch {
      return []
    }
  }

  listWithTitles(): Array<{ meta: SessionMeta; title: string }> {
    return this.list()
      .map((meta) => {
        try {
          return { meta, title: sessionDisplayTitle(meta, this.load(meta.id).messages) }
        } catch {
          return { meta, title: sessionDisplayTitle(meta) }
        }
      })
      .sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt))
  }
}