import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import type { Runtime } from "../cli/launch"
import { runTurn } from "../cli/launch"
import type { AgentMode } from "../engine/mode"
import type { PermissionReply, PermissionRequest } from "../engine/permission"
import type { SQLiteStore } from "../engine/sqlite"
import { sessionDisplayTitle } from "../engine/title"
import type {
  EngineEvent,
  ImagePart,
  Message,
  QuestionAnswer,
  QuestionPrompt,
  SessionMeta,
  SessionStatus,
  StoredEvent,
} from "../engine/types"
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
}

export interface CreateSessionInput {
  cwd?: string
  model?: string
  provider?: string
  title?: string
}

export interface PromptInput {
  text: string
  images?: ImagePart[]
  autoApprove?: boolean
  mode?: AgentMode
}

export interface PromptResult {
  sessionID: string
  message: Message
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

type DurableInput = EngineEvent | { type: "messageAdded"; message: Message }

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

  messages(id: string, limit?: number): Message[] {
    if (!this.store.has(id)) throw notFound(`session ${id} not found`)
    const messages = this.store.load(id).messages
    return limit && limit > 0 ? messages.slice(-limit) : messages
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
    return this.get(id)
  }

  rename(id: string, title: string): SessionView {
    if (!this.store.has(id)) throw notFound(`session ${id} not found`)
    this.store.rename(id, title)
    return this.get(id)
  }

  remove(id: string): void {
    if (!this.store.has(id)) throw notFound(`session ${id} not found`)
    if (this.active.has(id)) throw conflict("cannot delete a session with an active Turn")
    this.store.delete(id)
  }

  prompt(id: string, input: PromptInput): PromptResult {
    if (!this.store.has(id)) throw notFound(`session ${id} not found`)
    if (this.active.has(id)) throw conflict("session already has an active Turn")
    if (!input.text.trim()) throw badRequest("prompt text is required")
    const message: Message = {
      role: "user",
      content: input.text,
      ...(input.images?.length ? { images: input.images } : {}),
    }
    this.store.append(id, message)
    this.store.setStatus(id, "running")
    this.persist(id, { type: "messageAdded", message })

    const controller = new AbortController()
    const turn: ActiveTurn = { controller, promise: Promise.resolve() }
    this.active.set(id, turn)
    turn.promise = this.execute(id, controller, input).finally(() => {
      if (this.active.get(id) === turn) this.active.delete(id)
    })
    return { sessionID: id, message }
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
    this.listeners.clear()
  }

  private view(meta: SessionMeta, title: string): SessionView {
    const loaded = this.store.load(meta.id)
    return {
      ...loaded.meta,
      status: loaded.status,
      active: this.active.has(meta.id),
      title,
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
    }
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
