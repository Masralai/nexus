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
import type {
  DocumentRecord,
  EngineEvent,
  InboxItem,
  LoadedSession,
  Message,
  PermissionAuditRecord,
  SavedPermissionRecord,
  SessionCounters,
  SessionMeta,
  SessionStatus,
  SessionStore,
  SnapshotFile,
  StoredEvent,
} from "./types"
import type { Usage } from "../providers/types"

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
    const parts: PartRecord[] = [{ type: "text", data: { text: msg.content } }]
    for (const image of msg.images ?? []) parts.push({ type: "image", data: image })
    return parts
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

  rename(id: string, title: string): void {
    this.sqlite
      .query("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, new Date().toISOString(), id)
  }

  delete(id: string): void {
    this.sqlite.transaction(() => {
      this.sqlite.query("DELETE FROM session_parts WHERE session_id = ?").run(id)
      this.sqlite.query("DELETE FROM session_pending WHERE session_id = ?").run(id)
      this.sqlite.query("DELETE FROM session_inbox WHERE session_id = ?").run(id)
      this.sqlite.query("DELETE FROM event_sequence WHERE session_id = ?").run(id)
      this.sqlite.query("DELETE FROM jobs WHERE session_id = ?").run(id)
      this.sqlite.query("DELETE FROM sessions WHERE id = ?").run(id)
    })()
  }

  /** Case-insensitive title and message text search. */
  search(query: string, limit = 50): SessionMeta[] {
    const q = `%${query}%`
    const rows = this.sqlite
      .query(
        `SELECT DISTINCT s.* FROM sessions s
         LEFT JOIN session_parts p ON p.session_id = s.id
         WHERE s.title LIKE ? OR p.data LIKE ?
         ORDER BY s.updated_at DESC LIMIT ?`,
      )
      .all(q, q, limit) as SessionRow[]
    return rows.map(toMeta)
  }

  counters(id: string): SessionCounters {
    const row = this.sqlite
      .query(
        `SELECT input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, cost
         FROM sessions WHERE id = ?`,
      )
      .get(id) as
      | {
          input_tokens: number
          output_tokens: number
          reasoning_tokens: number
          cache_read_tokens: number
          cache_write_tokens: number
          cost: number
        }
      | null
    if (!row) throw new Error(`session ${id}: not found`)
    return {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      reasoningTokens: row.reasoning_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheWriteTokens: row.cache_write_tokens,
      cost: row.cost / 1_000_000,
    }
  }

  /** Usage is additive. Cost is stored in micro-dollars to keep exact integers. */
  addUsage(id: string, usage: Usage, cost = 0): void {
    this.sqlite
      .query(
        `UPDATE sessions SET
           input_tokens = input_tokens + ?,
           output_tokens = output_tokens + ?,
           reasoning_tokens = reasoning_tokens + ?,
           cache_read_tokens = cache_read_tokens + ?,
           cache_write_tokens = cache_write_tokens + ?,
           cost = cost + ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        usage.inputTokens || 0,
        usage.outputTokens || 0,
        usage.reasoningTokens || 0,
        usage.cacheReadTokens || 0,
        usage.cacheWriteTokens || 0,
        Math.round(cost * 1_000_000),
        new Date().toISOString(),
        id,
      )
  }

  appendEvent(id: string, event: EngineEvent | Record<string, unknown>): StoredEvent {
    const now = new Date().toISOString()
    const row = this.sqlite.transaction(() => {
      const r = this.sqlite
        .query(
          `INSERT INTO event_sequence (session_id, seq, event, created_at)
           VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM event_sequence WHERE session_id = ?), ?, ?)
           RETURNING id, seq`,
        )
        .get(id, id, JSON.stringify(event), now) as { id: number; seq: number }
      return { cursor: r.id, sessionID: id, seq: r.seq, event, createdAt: now }
    })()
    return row
  }

  /** Replay one Session's events after a per-Session sequence number. */
  eventsAfter(id: string, after = 0, limit = 10_000): StoredEvent[] {
    const rows = this.sqlite
      .query(
        "SELECT id, seq, event, created_at FROM event_sequence WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?",
      )
      .all(id, after, limit) as Array<{ id: number; seq: number; event: string; created_at: string }>
    return rows.map((r) => ({
      cursor: r.id,
      sessionID: id,
      seq: r.seq,
      event: JSON.parse(r.event) as Record<string, unknown>,
      createdAt: r.created_at,
    }))
  }

  /** Replay one Session's events after a global cursor. */
  eventsAfterCursor(id: string, after = 0, limit = 10_000): StoredEvent[] {
    const rows = this.sqlite
      .query(
        "SELECT id, seq, event, created_at FROM event_sequence WHERE session_id = ? AND id > ? ORDER BY id LIMIT ?",
      )
      .all(id, after, limit) as Array<{ id: number; seq: number; event: string; created_at: string }>
    return rows.map((r) => ({
      cursor: r.id,
      sessionID: id,
      seq: r.seq,
      event: JSON.parse(r.event) as Record<string, unknown>,
      createdAt: r.created_at,
    }))
  }

  /** Replay every Session's events after a global cursor. */
  listEventsAfter(after = 0, limit = 10_000): StoredEvent[] {
    const rows = this.sqlite
      .query("SELECT id, session_id, seq, event, created_at FROM event_sequence WHERE id > ? ORDER BY id LIMIT ?")
      .all(after, limit) as Array<{ id: number; session_id: string; seq: number; event: string; created_at: string }>
    return rows.map((r) => ({
      cursor: r.id,
      sessionID: r.session_id,
      seq: r.seq,
      event: JSON.parse(r.event) as Record<string, unknown>,
      createdAt: r.created_at,
    }))
  }

  lastEventCursor(): number {
    const row = this.sqlite.query("SELECT COALESCE(MAX(id), 0) AS cursor FROM event_sequence").get() as {
      cursor: number
    }
    return row.cursor
  }

  lastEventSeq(id: string): number {
    const row = this.sqlite
      .query("SELECT COALESCE(MAX(seq), 0) AS seq FROM event_sequence WHERE session_id = ?")
      .get(id) as { seq: number }
    return row.seq
  }

  putDocument(record: { id: string; sessionId?: string; kind: string; data: unknown }): void {
    this.sqlite
      .query(
        `INSERT INTO documents (id, session_id, kind, data, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, kind = excluded.kind`,
      )
      .run(record.id, record.sessionId ?? null, record.kind, JSON.stringify(record.data), new Date().toISOString())
  }

  getDocument(id: string): DocumentRecord | undefined {
    const row = this.sqlite.query("SELECT * FROM documents WHERE id = ?").get(id) as
      | { id: string; session_id: string | null; kind: string; data: string; created_at: string }
      | null
    if (!row) return undefined
    return {
      id: row.id,
      sessionId: row.session_id ?? undefined,
      kind: row.kind,
      data: JSON.parse(row.data),
      createdAt: row.created_at,
    }
  }

  listDocuments(sessionId?: string, kind?: string): DocumentRecord[] {
    let sql = "SELECT * FROM documents WHERE 1=1"
    const args: string[] = []
    if (sessionId) {
      sql += " AND session_id = ?"
      args.push(sessionId)
    }
    if (kind) {
      sql += " AND kind = ?"
      args.push(kind)
    }
    sql += " ORDER BY created_at DESC"
    const rows = this.sqlite.query(sql).all(...args) as Array<{
      id: string
      session_id: string | null
      kind: string
      data: string
      created_at: string
    }>
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id ?? undefined,
      kind: row.kind,
      data: JSON.parse(row.data),
      createdAt: row.created_at,
    }))
  }

  saveSnapshot(sessionId: string, label: string, files: SnapshotFile[]): string {
    const id = `snap_${Date.now().toString(36)}_${randomUUID()}`
    this.putDocument({ id, sessionId, kind: "snapshot", data: { label, files } })
    return id
  }

  getSnapshot(sessionId: string, id: string): { id: string; files: SnapshotFile[] } | undefined {
    const doc = this.getDocument(id)
    if (!doc || doc.kind !== "snapshot" || doc.sessionId !== sessionId) return undefined
    const data = doc.data as { files?: SnapshotFile[] }
    return { id, files: data.files ?? [] }
  }

  listSnapshots(sessionId: string): Array<{ id: string; label: string; createdAt: string }> {
    return this.listDocuments(sessionId, "snapshot").map((doc) => ({
      id: doc.id,
      label: String((doc.data as { label?: unknown })?.label ?? ""),
      createdAt: doc.createdAt,
    }))
  }

  queuePending(sessionId: string, kind: string, data: unknown): string {
    const id = `pend_${randomUUID()}`
    this.sqlite
      .query("INSERT INTO session_pending (id, session_id, kind, data, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, sessionId, kind, JSON.stringify(data), new Date().toISOString())
    return id
  }

  listPending(sessionId: string): Array<{ id: string; kind: string; data: unknown; createdAt: string }> {
    const rows = this.sqlite
      .query("SELECT * FROM session_pending WHERE session_id = ? ORDER BY created_at")
      .all(sessionId) as Array<{ id: string; kind: string; data: string; created_at: string }>
    return rows.map((r) => ({ id: r.id, kind: r.kind, data: JSON.parse(r.data), createdAt: r.created_at }))
  }

  deletePending(id: string): void {
    this.sqlite.query("DELETE FROM session_pending WHERE id = ?").run(id)
  }

  addInbox(sessionId: string, data: Record<string, unknown>): InboxItem {
    const id = `inbox_${randomUUID()}`
    const createdAt = new Date().toISOString()
    this.sqlite
      .query("INSERT INTO session_inbox (id, session_id, data, created_at) VALUES (?, ?, ?, ?)")
      .run(id, sessionId, JSON.stringify(data), createdAt)
    return { id, sessionId, data, createdAt }
  }

  listInbox(sessionId: string): InboxItem[] {
    const rows = this.sqlite
      .query("SELECT * FROM session_inbox WHERE session_id = ? ORDER BY created_at")
      .all(sessionId) as Array<{ id: string; session_id: string; data: string; created_at: string }>
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      data: JSON.parse(r.data),
      createdAt: r.created_at,
    }))
  }

  clearInbox(sessionId: string): void {
    this.sqlite.query("DELETE FROM session_inbox WHERE session_id = ?").run(sessionId)
  }

  savePermission(record: Omit<SavedPermissionRecord, "id" | "createdAt"> & { id?: string }): SavedPermissionRecord {
    const existing = this.sqlite
      .query(
        "SELECT * FROM saved_permissions WHERE COALESCE(project_id, '') = ? AND tool = ? AND COALESCE(pattern, '') = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(record.projectId ?? "", record.tool, record.pattern ?? "") as
      | { id: string; project_id: string | null; tool: string; pattern: string | null; action: string; created_at: string }
      | null
    const id = existing?.id ?? record.id ?? `perm_${randomUUID()}`
    const createdAt = existing?.created_at ?? new Date().toISOString()
    this.sqlite
      .query(
        `INSERT INTO saved_permissions (id, project_id, tool, pattern, action, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET action = excluded.action`,
      )
      .run(id, record.projectId ?? null, record.tool, record.pattern ?? null, record.action, createdAt)
    return { ...record, id, createdAt }
  }

  listPermissions(projectId?: string): SavedPermissionRecord[] {
    const rows = (
      projectId
        ? this.sqlite
            .query("SELECT * FROM saved_permissions WHERE project_id = ? ORDER BY created_at")
            .all(projectId)
        : this.sqlite.query("SELECT * FROM saved_permissions ORDER BY created_at").all()
    ) as Array<{
      id: string
      project_id: string | null
      tool: string
      pattern: string | null
      action: string
      created_at: string
    }>
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id ?? undefined,
      tool: r.tool,
      pattern: r.pattern ?? undefined,
      action: r.action as SavedPermissionRecord["action"],
      createdAt: r.created_at,
    }))
  }

  deletePermission(id: string): void {
    this.sqlite.query("DELETE FROM saved_permissions WHERE id = ?").run(id)
  }

  auditPermission(record: Omit<PermissionAuditRecord, "id" | "createdAt">): PermissionAuditRecord {
    const id = `audit_${randomUUID()}`
    const createdAt = new Date().toISOString()
    this.sqlite
      .query(
        "INSERT INTO permission_audit (id, session_id, tool, input, action, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, record.sessionId ?? null, record.tool, JSON.stringify(record.input), record.action, record.source, createdAt)
    return { ...record, id, createdAt }
  }

  listAudit(sessionId?: string, limit = 200): PermissionAuditRecord[] {
    const rows = (
      sessionId
        ? this.sqlite
            .query("SELECT * FROM permission_audit WHERE session_id = ? ORDER BY created_at DESC LIMIT ?")
            .all(sessionId, limit)
        : this.sqlite.query("SELECT * FROM permission_audit ORDER BY created_at DESC LIMIT ?").all(limit)
    ) as Array<{
      id: string
      session_id: string | null
      tool: string
      input: string
      action: string
      source: string
      created_at: string
    }>
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id ?? undefined,
      tool: r.tool,
      input: JSON.parse(r.input),
      action: r.action as PermissionAuditRecord["action"],
      source: r.source,
      createdAt: r.created_at,
    }))
  }

  ensureProject(worktree: string, vcs?: string): { id: string; worktree: string } {
    const existing = this.sqlite.query("SELECT * FROM projects WHERE worktree = ?").get(worktree) as
      | { id: string; worktree: string }
      | null
    if (existing) return existing
    const id = `proj_${randomUUID()}`
    const now = new Date().toISOString()
    this.sqlite
      .query("INSERT INTO projects (id, worktree, vcs, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, worktree, vcs ?? null, now, now)
    return { id, worktree }
  }

  listProjects(): Array<{ id: string; worktree: string; vcs?: string; updatedAt: string }> {
    const rows = this.sqlite.query("SELECT * FROM projects ORDER BY updated_at DESC").all() as Array<{
      id: string
      worktree: string
      vcs: string | null
      updated_at: string
    }>
    return rows.map((r) => ({ id: r.id, worktree: r.worktree, vcs: r.vcs ?? undefined, updatedAt: r.updated_at }))
  }

  recordWorktree(directory: string, strategy?: string): void {
    this.sqlite
      .query(
        "INSERT INTO worktrees (directory, strategy, created_at) VALUES (?, ?, ?) ON CONFLICT(directory) DO UPDATE SET strategy = excluded.strategy",
      )
      .run(directory, strategy ?? null, new Date().toISOString())
  }

  listWorktrees(): Array<{ directory: string; strategy?: string; createdAt: string }> {
    const rows = this.sqlite.query("SELECT * FROM worktrees ORDER BY created_at DESC").all() as Array<{
      directory: string
      strategy: string | null
      created_at: string
    }>
    return rows.map((r) => ({
      directory: r.directory,
      ...(r.strategy ? { strategy: r.strategy } : {}),
      createdAt: r.created_at,
    }))
  }

  forgetWorktree(directory: string): void {
    this.sqlite.query("DELETE FROM worktrees WHERE directory = ?").run(directory)
  }

  /** Remove the given message and everything after it. Returns removed part count. */
  revertTo(sessionId: string, messageId?: string): number {
    let boundary: number | undefined
    if (messageId) {
      const row = this.sqlite
        .query("SELECT MIN(seq) AS seq FROM session_parts WHERE session_id = ? AND message_id = ?")
        .get(sessionId, messageId) as { seq: number | null } | null
      boundary = row?.seq ?? undefined
    } else {
      const row = this.sqlite
        .query(
          "SELECT MIN(seq) AS seq FROM session_parts WHERE session_id = ? AND message_id = (SELECT message_id FROM session_parts WHERE session_id = ? AND role = 'user' AND part_type = 'text' ORDER BY seq DESC LIMIT 1)",
        )
        .get(sessionId, sessionId) as { seq: number | null } | null
      boundary = row?.seq ?? undefined
    }
    if (boundary === undefined) return 0
    const removed = this.sqlite.transaction(() => {
      const count = this.sqlite
        .query("SELECT COUNT(*) AS n FROM session_parts WHERE session_id = ? AND seq >= ?")
        .get(sessionId, boundary) as { n: number }
      this.sqlite.query("DELETE FROM session_parts WHERE session_id = ? AND seq >= ?").run(sessionId, boundary)
      this.sqlite
        .query("UPDATE sessions SET updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), sessionId)
      return count.n
    })()
    return removed
  }

  createJob(job: {
    id: string
    sessionId: string
    command: string
    status: string
    startedAt: string
  }): void {
    this.sqlite
      .query(
        "INSERT INTO jobs (id, session_id, command, status, output, started_at) VALUES (?, ?, ?, ?, '', ?)",
      )
      .run(job.id, job.sessionId, job.command, job.status, job.startedAt)
  }

  updateJob(
    id: string,
    patch: { status?: string; output?: string; exitCode?: number | null; endedAt?: string | null },
  ): void {
    const sets: string[] = []
    const args: Array<string | number | null> = []
    if (patch.status !== undefined) {
      sets.push("status = ?")
      args.push(patch.status)
    }
    if (patch.output !== undefined) {
      sets.push("output = ?")
      args.push(patch.output)
    }
    if (patch.exitCode !== undefined) {
      sets.push("exit_code = ?")
      args.push(patch.exitCode)
    }
    if (patch.endedAt !== undefined) {
      sets.push("ended_at = ?")
      args.push(patch.endedAt)
    }
    if (sets.length === 0) return
    args.push(id)
    this.sqlite.query(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...args)
  }

  getJob(id: string): {
    id: string
    sessionId: string
    command: string
    status: string
    output: string
    exitCode?: number
    startedAt: string
    endedAt?: string
  } | undefined {
    const r = this.sqlite.query("SELECT * FROM jobs WHERE id = ?").get(id) as
      | {
          id: string
          session_id: string
          command: string
          status: string
          output: string
          exit_code: number | null
          started_at: string
          ended_at: string | null
        }
      | null
    if (!r) return undefined
    return {
      id: r.id,
      sessionId: r.session_id,
      command: r.command,
      status: r.status,
      output: r.output,
      exitCode: r.exit_code ?? undefined,
      startedAt: r.started_at,
      endedAt: r.ended_at ?? undefined,
    }
  }

  listJobs(sessionId?: string): Array<NonNullable<ReturnType<SQLiteStore["getJob"]>>> {
    const rows = (
      sessionId
        ? this.sqlite.query("SELECT id FROM jobs WHERE session_id = ? ORDER BY started_at DESC").all(sessionId)
        : this.sqlite.query("SELECT id FROM jobs ORDER BY started_at DESC").all()
    ) as Array<{ id: string }>
    return rows.map((r) => this.getJob(r.id)!).filter(Boolean)
  }

  lastBoundary(sessionId: string): string | undefined {
    const row = this.sqlite
      .query("SELECT message_id FROM session_parts WHERE session_id = ? ORDER BY seq DESC LIMIT 1")
      .get(sessionId) as { message_id: string } | null
    return row?.message_id
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
    const images = parsed
      .filter((p) => p.type === "image")
      .map((p) => ({
        mimeType: String(p.data.mimeType ?? "application/octet-stream"),
        data: String(p.data.data ?? ""),
        ...(typeof p.data.path === "string" ? { path: p.data.path } : {}),
      }))
      .filter((i) => i.data)
    return { role: "user", content, ...(images.length ? { images } : {}) }
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
