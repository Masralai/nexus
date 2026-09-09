import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Message } from "./types"

export type SessionStatus = "running" | "done" | "aborted" | "error"

export interface SessionMeta {
  id: string
  cwd: string
  model: string
  provider: string
  createdAt: string
}

type Line =
  | { type: "meta"; session: SessionMeta }
  | { type: "msg"; msg: Message }
  | { type: "status"; status: SessionStatus }

export interface LoadedSession {
  meta: SessionMeta
  status: SessionStatus
  messages: Message[]
}

export function sessionTitle(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === "user" && typeof (m as unknown as { content?: unknown }).content === "string" && ((m as unknown as { content: string }).content.trim().length > 0))
  const rawCandidate: unknown = (firstUser as unknown as { content?: unknown })?.content ?? (messages[0] as unknown as { content?: unknown })?.content ?? ""
  if (typeof rawCandidate !== "string") return ""
  const firstLine = rawCandidate.split("\n")[0]?.trim() ?? ""
  if (!firstLine) return ""
  const max = 200
  return firstLine.length > max ? `${firstLine.slice(0, max)}…` : firstLine
}

export function sessionDisplayTitle(meta: SessionMeta, messages: Message[]): string {
  const t = sessionTitle(messages)
  return t || `${meta.id.slice(0, 8)}…`
}

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

  listWithTitles(): Array<{ meta: SessionMeta; title: string; messages: Message[] }> {
    return this.list()
      .map((meta) => {
        try {
          const loaded = this.load(meta.id)
          return { meta, messages: loaded.messages, title: sessionTitle(loaded.messages) || `${meta.id.slice(0, 8)}…` }
        } catch {
          return { meta, messages: [], title: `${meta.id.slice(0, 8)}…` }
        }
      })
      .sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt))
  }
}