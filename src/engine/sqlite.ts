import { Database } from "bun:sqlite"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readdirSync } from "node:fs"
import { dirname } from "node:path"
import { desc, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { MIGRATIONS } from "./migrations"
import * as schema from "./schema"
import { JSONLStore } from "./state"
import { sessionDisplayTitle, sessionTitle, titleFromText } from "./title"
import type { LoadedSession, Message, SessionMeta, SessionStatus, SessionStore } from "./types"

export interface SQLiteStoreOptions {
  path: string
}

/** Lexicographically sortable message id: timestamp prefix + random suffix. */
function sortableMessageId(): string {
  return `msg_${Date.now().toString(36).padStart(10, "0")}_${randomUUID()}`
}

export interface PartRecord {
  type: string
  data: unknown
}

interface PartRow {
  message_id: string
  part_type: string
  role: string | null
  data: string
  message_json: string | null
}

type SessionRow = typeof schema.sessions.$inferSelect

/** Part projection for one durable message. The message JSON is stored on the first part. */
export function partsForMessage(msg: Message): PartRecord[] {
  if (msg.role === "user") {
    if (msg.synthetic === "compaction") {
      return [{ type: "compaction", data: { text: msg.content, synthetic: "compaction" } }]
    }
    return [{ type: "text", data: { text: msg.content } }]
  }
  if (msg.role === "assistant") {
    const parts: PartRecord[] = []
    if (msg.content !== null) parts.push({ type: "text", data: { text: msg.content } })
    for (const call of msg.toolCalls ?? []) {
      parts.push({ type: "tool_call", data: { id: call.id, name: call.name, input: call.input } })
    }
    if (parts.length === 0) parts.push({ type: "text", data: { text: null } })
    return parts
  }
  return [
    {
      type: "tool_result",
      data: { toolCallId: msg.toolCallId, name: msg.name, result: msg.result },
    },
  ]
}

export class SQLiteStore implements SessionStore {
  readonly sqlite: Database
  private db: ReturnType<typeof drizzle<typeof schema>>
  private insertPart: ReturnType<Database["prepare"]>

  constructor(readonly opts: SQLiteStoreOptions) {
    if (opts.path !== ":memory:") mkdirSync(dirname(opts.path), { recursive: true })
    this.sqlite = new Database(opts.path, { create: true })
    this.sqlite.exec("PRAGMA journal_mode = WAL")
    this.sqlite.exec("PRAGMA busy_timeout = 5000")
    this.db = drizzle(this.sqlite, { schema })
    this.migrate()
    this.insertPart = this.sqlite.prepare(
      `INSERT INTO session_parts (session_id, message_id, seq, part_type, role, data, message_json, created_at)
       VALUES (?, ?, (SELECT COALESCE(MAX(seq), -1) + 1 FROM session_parts WHERE session_id = ?), ?, ?, ?, ?, ?)`,
    )
  }

  get path(): string {
    return this.opts.path
  }

  private migrate(): void {
    const row = this.sqlite.query("PRAGMA user_version").get() as { user_version: number } | null
    let version = row?.user_version ?? 0
    while (version < MIGRATIONS.length) {
      // DDL and the version bump commit together; a crash cannot leave a
      // half-applied migration that would fail permanently on reopen.
      this.sqlite.transaction(() => {
        this.sqlite.exec(MIGRATIONS[version])
        this.sqlite.exec(`PRAGMA user_version = ${version + 1}`)
      })()
      version++
    }
  }

  private insert(id: string, msg: Message): void {
    const messageId = sortableMessageId()
    const parts = partsForMessage(msg)
    const json = JSON.stringify(msg)
    const now = new Date().toISOString()
    this.sqlite.transaction(() => {
      parts.forEach((part, i) => {
        this.insertPart.run(
          id,
          messageId,
          id,
          part.type,
          msg.role,
          JSON.stringify(part.data),
          i === 0 ? json : null,
          now,
        )
      })
      if (msg.role === "user" && msg.synthetic !== "compaction") {
        this.sqlite
          .query("UPDATE sessions SET title = COALESCE(title, ?), updated_at = ? WHERE id = ?")
          .run(sessionTitle([msg]) || null, now, id)
      } else {
        this.sqlite.query("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, id)
      }
    })()
  }

  create(meta: SessionMeta, messages: Message[] = []): void {
    this.db
      .insert(schema.sessions)
      .values({
        id: meta.id,
        cwd: meta.cwd,
        model: meta.model,
        provider: meta.provider,
        parentId: meta.parentId ?? null,
        forkBoundary: meta.forkBoundary ?? null,
        title: meta.title ?? (sessionTitle(messages) || null),
        status: "running",
        createdAt: meta.createdAt,
        updatedAt: meta.createdAt,
      })
      .run()
    for (const msg of messages) this.append(meta.id, msg)
  }

  append(id: string, msg: Message): void {
    if (msg.role === "tool") {
      const owner = this.sqlite
        .query(
          "SELECT 1 AS one FROM session_parts WHERE session_id = ? AND part_type = 'tool_call' AND json_extract(data, '$.id') = ? LIMIT 1",
        )
        .get(id, msg.toolCallId)
      if (!owner) throw new Error(`session ${id}: orphan tool result ${msg.toolCallId}`)
    }
    this.insert(id, msg)
  }

  setStatus(id: string, status: SessionStatus): void {
    this.sqlite
      .query("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, new Date().toISOString(), id)
  }

  load(id: string): LoadedSession {
    const row = this.db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()
    if (!row) throw new Error(`session ${id}: not found`)
    const rows = this.sqlite
      .query(
        "SELECT message_id, part_type, role, data, message_json FROM session_parts WHERE session_id = ? ORDER BY seq",
      )
      .all(id) as PartRow[]
    const groups = new Map<string, PartRow[]>()
    for (const part of rows) {
      const group = groups.get(part.message_id)
      if (group) group.push(part)
      else groups.set(part.message_id, [part])
    }
    const messages: Message[] = []
    for (const group of groups.values()) {
      const message = messageFromParts(group)
      if (message) messages.push(message)
    }
    return {
      meta: toMeta(row),
      status: (row.status as SessionStatus) ?? "running",
      messages,
    }
  }

  list(): SessionMeta[] {
    const rows = this.db.select().from(schema.sessions).orderBy(desc(schema.sessions.createdAt)).all()
    return rows.map(toMeta)
  }

  private firstUserText(id: string): string | undefined {
    const row = this.sqlite
      .query(
        "SELECT data FROM session_parts WHERE session_id = ? AND role = 'user' AND part_type = 'text' ORDER BY seq LIMIT 1",
      )
      .get(id) as { data: string } | null
    if (!row) return undefined
    try {
      const data = JSON.parse(row.data) as { text?: unknown }
      return typeof data.text === "string" ? data.text : undefined
    } catch {
      return undefined
    }
  }

  /** Picker metadata only: never loads message history for every session. */
  listWithTitles(): Array<{ meta: SessionMeta; title: string }> {
    return this.list().map((meta) => {
      const text = meta.title ? "" : (this.firstUserText(meta.id) ?? "")
      return {
        meta,
        title: sessionDisplayTitle({ id: meta.id, title: meta.title || titleFromText(text) }),
      }
    })
  }

  has(id: string): boolean {
    const row = this.sqlite.query("SELECT 1 AS one FROM sessions WHERE id = ?").get(id)
    return Boolean(row)
  }

  count(): number {
    const row = this.sqlite.query("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }
    return row.n
  }

  getKv(key: string): string | undefined {
    const row = this.sqlite.query("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | null
    return row?.value
  }

  setKv(key: string, value: string): void {
    this.sqlite
      .query(
        "INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .run(key, value, new Date().toISOString())
  }

  /** Idempotent import of the JSONL session format. */
  importLegacy(dir: string): number {
    if (!existsSync(dir)) return 0
    const legacy = new JSONLStore(dir)
    let imported = 0
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".jsonl")) continue
      const id = file.replace(/\.jsonl$/, "")
      if (this.has(id)) continue
      let loaded: LoadedSession
      try {
        loaded = legacy.load(id)
      } catch {
        continue
      }
      const existed = this.has(loaded.meta.id)
      try {
        this.create(loaded.meta, loaded.messages)
        if (loaded.status !== "running") this.setStatus(loaded.meta.id, loaded.status)
        imported++
      } catch {
        // Roll back only this attempt; never delete a pre-existing session.
        if (!existed) {
          this.sqlite.query("DELETE FROM session_parts WHERE session_id = ?").run(loaded.meta.id)
          this.sqlite.query("DELETE FROM sessions WHERE id = ?").run(loaded.meta.id)
        }
      }
    }
    return imported
  }

  close(): void {
    this.sqlite.close()
  }
}

function messageFromParts(parts: PartRow[]): Message | undefined {
  const first = parts[0]
  if (!first?.role) {
    return first?.message_json ? (JSON.parse(first.message_json) as Message) : undefined
  }
  const parsed = parts.map((part) => ({
    type: part.part_type,
    data: JSON.parse(part.data) as Record<string, unknown>,
  }))
  if (first.role === "user") {
    const compaction = parsed.find((p) => p.type === "compaction")
    if (compaction) {
      return {
        role: "user",
        content: String(compaction.data.text ?? ""),
        synthetic: "compaction",
      }
    }
    const content = parsed
      .filter((p) => p.type === "text")
      .map((p) => String(p.data.text ?? ""))
      .join("")
    return { role: "user", content }
  }
  if (first.role === "assistant") {
    const texts = parsed.filter((p) => p.type === "text")
    const content =
      texts.length === 0 || texts.every((p) => p.data.text === null)
        ? null
        : texts.map((p) => String(p.data.text ?? "")).join("")
    const toolCalls = parsed
      .filter((p) => p.type === "tool_call")
      .map((p) => ({
        id: String(p.data.id ?? ""),
        name: String(p.data.name ?? ""),
        input: p.data.input,
      }))
    return {
      role: "assistant",
      content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    }
  }
  const tool = parsed.find((p) => p.type === "tool_result")
  if (!tool) return first.message_json ? (JSON.parse(first.message_json) as Message) : undefined
  return {
    role: "tool",
    toolCallId: String(tool.data.toolCallId ?? ""),
    name: String(tool.data.name ?? ""),
    result: tool.data.result as { ok: boolean; output: string; error?: string },
  }
}

function toMeta(row: SessionRow): SessionMeta {
  return {
    id: row.id,
    cwd: row.cwd,
    model: row.model,
    provider: row.provider,
    createdAt: row.createdAt,
    parentId: row.parentId ?? undefined,
    forkBoundary: row.forkBoundary ?? undefined,
    title: row.title ?? undefined,
  }
}
