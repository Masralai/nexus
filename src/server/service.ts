import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import type { Runtime } from "../cli/launch"
import { runTurn } from "../cli/launch"
import type { AgentMode } from "../engine/mode"
import type { PermissionReply, PermissionRequest } from "../engine/permission"
import type { SessionExport } from "../engine/session-io"
import type { SQLiteStore } from "../engine/sqlite"
import { maybeGenerateTitle, sessionDisplayTitle } from "../engine/title"
import type {
  EngineEvent,
  ImagePart,
  Message,
  QuestionAnswer,
  QuestionPrompt,
  SessionCounters,
  SessionMeta,
  SessionStatus,
  StoredEvent,
} from "../engine/types"
import { getModelInfo, type ModelInfo } from "../providers/catalog"
import type { Skill } from "../skills"
import { badRequest, conflict, notFound } from "./errors"

export interface WireEvent {
  id: string
  /** Global resumable cursor. SSE clients echo this as the last event id. */
  cursor: number
  /** Per-Session sequence number. */
  seq: number
  sessionID: string
  created: string
  type: string
  data: Record<string, unknown>
}

export interface SessionView extends SessionMeta {
  status: SessionStatus
  active: boolean
  title: string
  usage: SessionCounters
  modelInfo: ModelInfo
}

export interface CreateSessionInput {
  cwd?: string
  model?: string
  provider?: string
  title?: string
}

export interface UpdateSessionInput {
  title?: string
  model?: string
  provider?: string
}

export interface PromptInput {
  text: string
  images?: ImagePart[]
  autoApprove?: boolean
  mode?: AgentMode
  skills?: Skill[]
  agent?: { prompt?: string; tools?: string[]; mode?: AgentMode }
}

export interface PromptResult {
  sessionID: string
  message: Message
  /** Global cursor after the prompt was persisted; subscribe from here. */
  cursor: number
  /** True when a Turn was active and the input was queued for steering. */
  queued?: boolean
}

export type RuntimeFactory = (input: { cwd: string; model?: string; store: SQLiteStore }) => Runtime

export interface SessionServiceOptions {
  store: SQLiteStore
  defaultCwd: string
  runtimeFactory: RuntimeFactory
  /** Mark persisted `running` sessions as aborted at boot. Defaults to true. */
  recoverOrphans?: boolean
}

interface ActiveTurn {
  controller: AbortController
  promise: Promise<void>
}

interface PendingPermission {
  sessionID: string
  id: string
  name: string
  input: unknown
  reason: string
  promise: Promise<PermissionReply>
  resolve: (reply: PermissionReply) => void
}

interface PendingQuestion {
  sessionID: string
  id: string
  questions: QuestionPrompt[]
  promise: Promise<QuestionAnswer[]>
  resolve: (answers: QuestionAnswer[]) => void
  /** A tool has attached to this request and is awaiting the reply. */
  claimed: boolean
}

type DurableInput =
  | EngineEvent
  | { type: "messageQueued"; message: Message }
  | { type: "titleUpdated"; title: string }
  | { type: "sessionCreated"; session: SessionView }
  | { type: "sessionUpdated"; session: SessionView; patch: UpdateSessionInput }
  | { type: "sessionImported"; session: SessionView }
  | { type: "sessionDeleted"; session: SessionView }
  | { type: "sessionStatus"; status: SessionStatus }
  | { type: "sessionReverted"; messageID?: string; removed: number }
  | { type: "sessionForked"; parentID: string; messageID?: string }

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function eventType(event: Record<string, unknown>): string {
  return typeof event.type === "string" ? event.type : "unknown"
}

/** Wire projection of a durable event. The engine payload stays in `data`. */
export function wireEvent(sessionID: string, stored: StoredEvent): WireEvent {
  const event = stored.event as Record<string, unknown>
  const data = { ...event }
  delete data.type
  return {
    id: `evt_${sessionID}_${stored.seq}`,
    cursor: stored.cursor,
    seq: stored.seq,
    sessionID,
    created: stored.createdAt,
    type: eventType(event),
    data,
  }
}

/**
 * Server-owned Session and Turn state. Every engine event is persisted before
 * it is broadcast so a disconnected client can replay from its last cursor.
 */
export class SessionService {
  private readonly store: SQLiteStore
  private readonly defaultCwd: string
  private readonly runtimeFactory: RuntimeFactory
  private readonly runtimes = new Map<string, Runtime>()
  private readonly active = new Map<string, ActiveTurn>()
  private readonly permissions = new Map<string, PendingPermission>()
  private readonly questions = new Map<string, PendingQuestion[]>()
  private readonly listeners = new Set<(event: WireEvent) => void>()

  constructor(options: SessionServiceOptions) {
    this.store = options.store
    this.defaultCwd = options.defaultCwd
    this.runtimeFactory = options.runtimeFactory
    if (options.recoverOrphans !== false) this.recoverOrphans()
  }

  private recoverOrphans(): void {
    for (const meta of this.store.list()) {
      if (this.store.load(meta.id).status === "running") this.store.setStatus(meta.id, "aborted")
    }
  }

  private runtime(cwd: string, model?: string): Runtime {
    const key = `${cwd}\0${model ?? ""}`
    const existing = this.runtimes.get(key)
    if (existing) return existing
    const runtime = this.runtimeFactory({ cwd, model, store: this.store })
    this.runtimes.set(key, runtime)
    return runtime
  }

  /** Public workspace seam for local resource routes (fs, mcp, pty, plugin, generate). */
  workspace(cwd?: string, model?: string): Runtime {
    return this.runtime(resolve(cwd ?? this.defaultCwd), model)
  }

  defaultWorkspace(): Runtime {
    return this.workspace()
  }

  workspaces(): Array<{ directory: string; model?: string }> {
    return [...this.runtimes.keys()].map((key) => {
      const [directory, model] = key.split("\0")
      return { directory, ...(model ? { model } : {}) }
    })
  }

  /** Close cached services for one workspace. Its next use boots fresh. */
  evictWorkspace(cwd: string, model?: string): boolean {
    const key = `${resolve(cwd)}\0${model ?? ""}`
    const runtime = this.runtimes.get(key)
    if (!runtime) return false
    this.runtimes.delete(key)
    void runtime.close?.()
    return true
  }

  /** Rebuild idle workspace services; active Turns keep their runtime until they finish. */
  async reloadWorkspaces(): Promise<void> {
    const busy = new Set<string>()
    for (const id of this.active.keys()) {
      const meta = this.store.load(id).meta
      busy.add(`${resolve(meta.cwd)}\0${meta.model ?? ""}`)
    }
    const closing: Runtime[] = []
    for (const [key, runtime] of this.runtimes) {
      if (busy.has(key)) continue
      this.runtimes.delete(key)
      closing.push(runtime)
    }
    await Promise.allSettled(closing.map((runtime) => runtime.close?.()))
  }

  listProjects(): ReturnType<SQLiteStore["listProjects"]> {
    return this.store.listProjects()
  }

  updateProject(
    id: string,
    patch: { canonical?: string; name?: string; icon?: Record<string, unknown>; commands?: Record<string, unknown> },
  ): ReturnType<SQLiteStore["updateProject"]> {
    try {
      return this.store.updateProject(id, patch)
    } catch (error) {
      if (/not found/.test(error instanceof Error ? error.message : "")) throw notFound(`project ${id} not found`)
      throw badRequest(error instanceof Error ? error.message : String(error))
    }
  }

  projectFor(worktree: string): { id: string; directory: string; canonical: string; worktree: string } {
    const project = this.store.ensureProject(worktree)
    return {
      id: project.id,
      directory: project.worktree,
      canonical: project.worktree,
      worktree: project.worktree,
    }
  }

  pluginInfo(cwd?: string): Array<Record<string, unknown>> {
    const runtime = cwd ? this.workspace(cwd) : this.defaultWorkspace()
    const active = (runtime.plugins?.list() ?? []).map((plugin) => ({
      id: plugin.name,
      source: { type: "local", path: "" },
      features: { server: true },
      state: { status: "active" },
    }))
    const failed = (runtime.pluginErrors ?? []).map((error) => ({
      source: { type: "local", path: error.path },
      features: {},
      state: { status: "failed", error: error.message, ref: error.path },
    }))
    return [...active, ...failed]
  }

  async generate(input: { prompt: string; model?: string }): Promise<string> {
    if (!input.prompt.trim()) throw badRequest("prompt is required")
    const runtime = this.defaultWorkspace()
    const provider = runtime.providerFor?.(input.model) ?? runtime.provider
    let text = ""
    for await (const event of provider.stream([{ role: "user", content: input.prompt }], [], {})) {
      if (event.type === "token") text += event.text
      else if (event.type === "done" && event.content) text = event.content
    }
    return text
  }

  pendingForms(): Array<Record<string, unknown>> {
    const forms: Array<Record<string, unknown>> = []
    for (const [sessionID, pending] of this.questions) {
      for (const request of pending) {
        forms.push({
          id: request.id,
          sessionID,
          title: request.questions[0]?.header ?? "Question",
          fields: request.questions.map((question) => ({
            type: "string",
            key: question.header,
            label: question.question,
            options: question.options.map((option) => ({
              value: option.label,
              label: option.label,
              ...(option.description ? { description: option.description } : {}),
            })),
          })),
        })
      }
    }
    return forms
  }

  list(query?: string, limit = 50): SessionView[] {
    if (query?.trim()) {
      return this.store
        .search(query.trim(), limit)
        .map((meta) => this.view(meta, sessionDisplayTitle(meta, this.store.load(meta.id).messages)))
    }
    return this.store
      .listWithTitles()
      .slice(0, limit)
      .map(({ meta, title }) => this.view(meta, title))
  }

  get(id: string): SessionView {
    if (!this.store.has(id)) throw notFound(`session ${id} not found`)
    const loaded = this.store.load(id)
    return this.view(loaded.meta, sessionDisplayTitle(loaded.meta, loaded.messages))
  }

  messages(id: string, limit?: number): Array<Message & { id: string }> {
    if (!this.store.has(id)) throw notFound(`session ${id} not found`)
    const messages = this.store.messageEntries(id)
    const selected = limit && limit > 0 ? messages.slice(-limit) : messages
    return selected.map((entry) => ({ ...entry.message, id: entry.id }))
  }

  usage(id: string): SessionCounters & { model: ModelInfo } {
    if (!this.store.has(id)) throw notFound(`session ${id} not found`)
    const meta = this.store.load(id).meta
    return { ...this.store.counters(id), model: getModelInfo(meta.model) }
  }

  create(input: CreateSessionInput = {}): SessionView {
    const cwd = resolve(input.cwd ?? this.defaultCwd)
    const runtime = this.runtime(cwd, input.model)
    const id = `ses_${randomUUID()}`
    const meta: SessionMeta = {
      id,
      cwd,
      model: input.model ?? (runtime.cfg.model || "unknown"),
      provider: input.provider ?? runtime.cfg.provider,
      createdAt: new Date().toISOString(),
      ...(input.title ? { title: input.title } : {}),
    }
    this.store.create(meta)
    // A fresh Session has no active Turn; do not present it as a crash orphan.
    this.store.setStatus(id, "done")
    const view = this.get(id)
    this.persist(id, { type: "sessionCreated", session: view })
    return view
  }

  update(id: string, input: UpdateSessionInput): SessionView {
    if (!this.store.has(id)) throw notFound(`session ${id} not found`)
    const patch: UpdateSessionInput = {}
    if (input.title !== undefined) patch.title = input.title
    if (input.model !== undefined) {
      if (!input.model.trim()) throw badRequest("model must be a non-empty string")
      patch.model = input.model
    }
    if (input.provider !== undefined) {
      if (!input.provider.trim()) throw badRequest("provider must be a non-empty string")
      patch.provider = input.provider
    }
    if (Object.keys(patch).length === 0) throw badRequest("title, model, or provider is required")
    this.store.update(id, patch)
    const view = this.get(id)
    this.persist(id, { type: "sessionUpdated", session: view, patch })
    return view
  }

  rename(id: string, title: string): SessionView {
    return this.update(id, { title })
  }

  remove(id: string): void {
    if (!this.store.has(id)) throw notFound(`session ${id} not found`)
    if (this.active.has(id)) throw conflict("cannot delete a session with an active Turn")
    const view = this.get(id)
    this.store.delete(id)
    this.persist(id, { type: "sessionDeleted", session: view })
  }

  revert(id: string, messageID?: string): SessionView {
    if (!this.store.has(id)) throw notFound(`session ${id} not found`)
    if (this.active.has(id)) throw conflict("cannot revert a session with an active Turn")
    const removed = this.store.revertTo(id, messageID)
    if (removed === 0) {
      if (messageID) throw notFound(`message ${messageID} not found in session ${id}`)
      return this.get(id)
    }
    this.store.setStatus(id, "done")
    this.persist(id, { type: "sessionReverted", ...(messageID ? { messageID } : {}), removed })
    return this.get(id)
  }

  fork(id: string, messageID?: string, title?: string): SessionView {
    if (!this.store.has(id)) throw notFound(`session ${id} not found`)
    if (this.active.has(id)) throw conflict("cannot fork a session with an active Turn")
    if (messageID && !this.store.messageEntries(id).some((entry) => entry.id === messageID)) {
      throw notFound(`message ${messageID} not found in session ${id}`)
    }
    const meta: SessionMeta = this.store.fork(id, {
      ...(messageID ? { boundary: messageID } : {}),
      ...(title ? { title } : {}),
    })
    this.persist(meta.id, { type: "sessionForked", parentID: id, ...(messageID ? { messageID } : {}) })
    return this.get(meta.id)
  }

  exportSession(id: string): SessionExport {
    if (!this.store.has(id)) throw notFound(`session ${id} not found`)
    return this.store.exportSession(id)
  }

  importSession(raw: unknown): { session: SessionView; imported: boolean } {
    let result: ReturnType<SQLiteStore["importSession"]>
    try {
      result = this.store.importSession(raw)
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : String(error))
    }
    const session = this.get(result.meta.id)
    if (result.imported) this.persist(session.id, { type: "sessionImported", session })
    return { session, imported: result.imported }
  }

  prompt(id: string, input: PromptInput): PromptResult {
    if (!this.store.has(id)) throw notFound(`session ${id} not found`)
    if (!input.text.trim()) throw badRequest("prompt text is required")
    const message: Message = {
      role: "user",
      content: input.text,
      ...(input.images?.length ? { images: input.images } : {}),
    }
    if (this.active.has(id)) {
      this.store.queuePending(id, "prompt", {
        message,
        ...(input.autoApprove ? { autoApprove: true } : {}),
        ...(input.mode ? { mode: input.mode } : {}),
      })
      this.persist(id, { type: "messageQueued", message })
      return { sessionID: id, message, cursor: this.lastCursor(), queued: true }
    }
    this.flushPending(id)
    this.store.append(id, message)
    this.store.setStatus(id, "running")
    this.persist(id, { type: "sessionStatus", status: "running" })
    this.persist(id, { type: "messageAdded", message })

    const controller = new AbortController()
    const turn: ActiveTurn = { controller, promise: Promise.resolve() }
    this.active.set(id, turn)
    turn.promise = this.execute(id, controller, input).finally(() => {
      if (this.active.get(id) === turn) this.active.delete(id)
    })
    return { sessionID: id, message, cursor: this.lastCursor() }
  }

  interrupt(id: string): boolean {
    if (!this.store.has(id)) throw notFound(`session ${id} not found`)
    const turn = this.active.get(id)
    if (!turn) return false
    this.rejectPending(id)
    turn.controller.abort()
    return true
  }

  pendingPermissions(sessionID: string): PermissionRequest[] {
    return [...this.permissions.values()]
      .filter((pending) => pending.sessionID === sessionID)
      .map(({ id, name, input, reason }) => ({ id, name, input, reason }))
  }

  pendingQuestions(sessionID: string): Array<{ id: string; questions: QuestionPrompt[] }> {
    return (this.questions.get(sessionID) ?? []).map(({ id, questions }) => ({ id, questions }))
  }

  replyPermission(sessionID: string, requestID: string, reply: PermissionReply): void {
    const key = `${sessionID}\0${requestID}`
    const pending = this.permissions.get(key)
    if (!pending) throw notFound(`permission request ${requestID} not found`)
    this.permissions.delete(key)
    pending.resolve(reply)
  }

  replyQuestion(sessionID: string, requestID: string, answers: QuestionAnswer[]): void {
    const pending = this.questions.get(sessionID) ?? []
    const index = requestID === "latest" ? pending.length - 1 : pending.findIndex((item) => item.id === requestID)
    if (index < 0 || !pending[index]) throw notFound(`question request ${requestID} not found`)
    const [item] = pending.splice(index, 1)
    if (pending.length === 0) this.questions.delete(sessionID)
    item.resolve(answers)
  }

  subscribe(listener: (event: WireEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Replay one Session from a global cursor. */
  eventsAfter(sessionID: string, after = 0): WireEvent[] {
    return this.store.eventsAfterCursor(sessionID, after).map((stored) => wireEvent(sessionID, stored))
  }

  /** Replay every Session from a global cursor. */
  allEventsAfter(after = 0): WireEvent[] {
    return this.store.listEventsAfter(after).map((stored) => wireEvent(stored.sessionID, stored))
  }

  lastCursor(): number {
    return this.store.lastEventCursor()
  }

  async shutdown(): Promise<void> {
    for (const id of this.active.keys()) this.rejectPending(id)
    for (const turn of this.active.values()) turn.controller.abort()
    await Promise.allSettled([...this.active.values()].map((turn) => turn.promise))
    await Promise.allSettled([...this.runtimes.values()].map((runtime) => runtime.close?.()))
    this.runtimes.clear()
    this.listeners.clear()
  }

  private view(meta: SessionMeta, title: string): SessionView {
    const loaded = this.store.load(meta.id)
    return {
      ...loaded.meta,
      status: loaded.status,
      active: this.active.has(meta.id),
      title,
      usage: this.store.counters(meta.id),
      modelInfo: getModelInfo(meta.model),
    }
  }

  private async execute(id: string, controller: AbortController, input: PromptInput): Promise<void> {
    const loaded = this.store.load(id)
    const runtime = this.runtime(loaded.meta.cwd, loaded.meta.model)
    try {
      const events = runTurn({
        messages: loaded.messages,
        sessionId: id,
        cwd: loaded.meta.cwd,
        model: loaded.meta.model,
        runtime,
        resume: true,
        signal: controller.signal,
        autoApprove: input.autoApprove,
        mode: input.mode,
        ...(input.skills ? { skills: input.skills } : {}),
        ...(input.agent ? { agent: input.agent } : {}),
        askPermission: (request) => this.askPermission(id, request),
        askQuestion: (questions, requestID) => this.askQuestion(id, questions, requestID),
      })
      for await (const event of events) {
        if (event.type === "permissionRequest") this.ensurePermission(id, event)
        if (event.type === "questionRequest") this.ensureQuestion(id, event)
        this.persist(id, event)
      }
    } catch (error) {
      const aborted = controller.signal.aborted
      this.store.setStatus(id, aborted ? "aborted" : "error")
      this.persist(
        id,
        aborted ? { type: "aborted" } : { type: "error", message: error instanceof Error ? error.message : String(error) },
      )
    } finally {
      this.clearPending(id)
      this.persist(id, { type: "sessionStatus", status: this.store.load(id).status })
    }
    await this.maybeGenerateTitle(id)
  }

  private askPermission(
    sessionID: string,
    request: { id: string; name: string; input: unknown; reason: string },
  ): Promise<PermissionReply> {
    this.ensurePermission(sessionID, request)
    return this.permissions.get(`${sessionID}\0${request.id}`)!.promise
  }

  private ensurePermission(
    sessionID: string,
    request: { id: string; name: string; input: unknown; reason: string },
  ): void {
    const key = `${sessionID}\0${request.id}`
    if (this.permissions.has(key)) return
    const { promise, resolve } = deferred<PermissionReply>()
    this.permissions.set(key, {
      sessionID,
      id: request.id,
      name: request.name,
      input: request.input,
      reason: request.reason,
      promise,
      resolve,
    })
  }

  private askQuestion(
    sessionID: string,
    questions: QuestionPrompt[],
    requestID: string,
  ): Promise<QuestionAnswer[]> {
    const list = this.questions.get(sessionID) ?? []
    const existing =
      list.find((item) => item.id === requestID) ?? list.find((item) => !item.claimed)
    if (existing) {
      existing.claimed = true
      return existing.promise
    }
    // Direct tool use without a preceding event: create an addressable request.
    const waiter = this.newQuestion(sessionID, requestID, questions)
    waiter.claimed = true
    list.push(waiter)
    this.questions.set(sessionID, list)
    return waiter.promise
  }

  private ensureQuestion(
    sessionID: string,
    request: { id: string; questions: QuestionPrompt[] },
  ): void {
    const list = this.questions.get(sessionID) ?? []
    if (list.some((item) => item.id === request.id)) return
    list.push(this.newQuestion(sessionID, request.id, request.questions))
    this.questions.set(sessionID, list)
  }

  private newQuestion(sessionID: string, id: string, questions: QuestionPrompt[]): PendingQuestion {
    const { promise, resolve } = deferred<QuestionAnswer[]>()
    return { sessionID, id, questions, promise, resolve, claimed: false }
  }

  private rejectPending(sessionID: string): void {
    for (const [key, pending] of this.permissions) {
      if (pending.sessionID !== sessionID) continue
      this.permissions.delete(key)
      pending.resolve(false)
    }
    for (const pending of this.questions.get(sessionID) ?? []) pending.resolve([])
    this.questions.delete(sessionID)
  }

  private clearPending(sessionID: string): void {
    for (const [key, pending] of this.permissions) {
      if (pending.sessionID === sessionID) this.permissions.delete(key)
    }
    this.questions.delete(sessionID)
  }

  /** Apply input left queued by a Turn that aborted before its next boundary. */
  private flushPending(sessionID: string): void {
    for (const item of this.store.takePending(sessionID, "prompt")) {
      const message = (item.data as { message?: Message }).message
      if (!message || message.role !== "user") continue
      this.store.append(sessionID, message)
      this.persist(sessionID, { type: "messageAdded", message, queued: true })
    }
  }

  private async maybeGenerateTitle(sessionID: string): Promise<void> {
    const loaded = this.store.load(sessionID)
    const runtime = this.runtime(loaded.meta.cwd, loaded.meta.model)
    try {
      await maybeGenerateTitle(this.store, sessionID, runtime.titleProvider, {
        disabled: runtime.cfg.autoTitle === false,
        model: runtime.cfg.titleModel || runtime.cfg.compactModel,
        onRename: (title) => this.persist(sessionID, { type: "titleUpdated", title }),
      })
    } catch {
      // A title is cosmetic; never fail a completed Turn for it.
    }
  }

  private persist(sessionID: string, event: DurableInput): WireEvent {
    const stored = this.store.appendEvent(sessionID, event as unknown as Record<string, unknown>)
    const wire = wireEvent(sessionID, stored)
    for (const listener of this.listeners) {
      try {
        listener(wire)
      } catch {
        // A broken subscriber must not fail the Turn.
      }
    }
    return wire
  }
}
