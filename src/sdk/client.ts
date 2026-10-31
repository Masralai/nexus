import { ROUTES, routePath, type RouteName } from "../server/contract"
import type { WireEvent } from "../server/service"

export { ROUTES, routePath }
export type { RouteName, WireEvent }

export class NexusApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "NexusApiError"
  }
}

export interface NexusClientOptions {
  url: string
  token: string
  fetch?: typeof fetch
}

/**
 * Typed HTTP client over the same route table the server serves.
 * This is the M2 skeleton: resource methods plus a resumable event stream.
 */
export class NexusClient {
  readonly url: string
  readonly token: string
  private readonly fetchImpl: typeof fetch

  constructor(options: NexusClientOptions) {
    this.url = options.url.replace(/\/+$/, "")
    this.token = options.token
    this.fetchImpl = options.fetch ?? fetch
  }

  async request<T>(
    name: RouteName,
    params: Record<string, string> = {},
    init: RequestInit & { query?: Record<string, string | number | undefined> } = {},
  ): Promise<T> {
    const route = ROUTES[name]
    const url = new URL(this.url + routePath(name, params))
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value))
    }
    const headers = new Headers(init.headers)
    headers.set("authorization", `Bearer ${this.token}`)
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json")
    }
    const rest = { ...init }
    delete rest.query
    const res = await this.fetchImpl(url, { ...rest, method: route.method, headers })
    if (res.status === 204) return undefined as T
    const parsed = (await res.json()) as { data?: T; error?: { code: string; message: string } }
    if (!res.ok) {
      throw new NexusApiError(res.status, parsed.error?.code ?? "internal", parsed.error?.message ?? res.statusText)
    }
    return parsed.data as T
  }

  info() {
    return this.request<Record<string, unknown>>("info")
  }

  config() {
    return this.request<Record<string, unknown>>("config")
  }

  listSessions(query?: string, limit?: number) {
    return this.request<unknown[]>("sessions", {}, { query: { search: query, limit } })
  }

  createSession(body: Record<string, unknown> = {}) {
    return this.request<Record<string, unknown>>("sessionCreate", {}, { body: JSON.stringify(body) })
  }

  getSession(sessionID: string) {
    return this.request<Record<string, unknown>>("session", { sessionID })
  }

  renameSession(sessionID: string, title: string) {
    return this.request<void>("sessionUpdate", { sessionID }, { body: JSON.stringify({ title }) })
  }

  deleteSession(sessionID: string) {
    return this.request<void>("sessionDelete", { sessionID })
  }

  revertSession(sessionID: string, messageID?: string) {
    return this.request<Record<string, unknown>>(
      "sessionRevert",
      { sessionID },
      { body: JSON.stringify(messageID ? { messageID } : {}) },
    )
  }

  forkSession(sessionID: string, opts: { messageID?: string; title?: string } = {}) {
    return this.request<Record<string, unknown>>(
      "sessionFork",
      { sessionID },
      { body: JSON.stringify(opts) },
    )
  }

  exportSession(sessionID: string) {
    return this.request<Record<string, unknown>>("sessionExport", { sessionID })
  }

  importSession(body: Record<string, unknown>) {
    return this.request<{ session: Record<string, unknown>; imported: boolean }>(
      "sessionImport",
      {},
      { body: JSON.stringify(body) },
    )
  }

  sessionUsage(sessionID: string) {
    return this.request<Record<string, unknown>>("sessionUsage", { sessionID })
  }

  messages(sessionID: string, limit?: number) {
    return this.request<unknown[]>("messages", { sessionID }, { query: { limit } })
  }

  prompt(sessionID: string, body: { text: string; images?: unknown[]; autoApprove?: boolean; mode?: string }) {
    return this.request<unknown>("prompt", { sessionID }, { body: JSON.stringify(body) })
  }

  interrupt(sessionID: string) {
    return this.request<void>("interrupt", { sessionID })
  }

  replyPermission(sessionID: string, requestID: string, decision: boolean | "always" | "once" | "deny") {
    return this.request<void>(
      "permissionReply",
      { sessionID, requestID },
      { body: JSON.stringify({ decision }) },
    )
  }

  replyQuestion(sessionID: string, requestID: string, answers: unknown[]) {
    return this.request<void>(
      "questionReply",
      { sessionID, requestID },
      { body: JSON.stringify({ answers }) },
    )
  }

  /** Follow SSE and yield wire events. Pass `after` to resume from a cursor. */
  async *events(opts: { sessionID?: string; after?: number; signal?: AbortSignal } = {}): AsyncGenerator<WireEvent> {
    const path = opts.sessionID
      ? routePath("sessionEvents", { sessionID: opts.sessionID })
      : routePath("events")
    const url = new URL(this.url + path)
    if (opts.after !== undefined) url.searchParams.set("after", String(opts.after))
    const res = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${this.token}` },
      signal: opts.signal,
    })
    if (!res.ok || !res.body) {
      const parsed = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } }
      throw new NexusApiError(res.status, parsed.error?.code ?? "internal", parsed.error?.message ?? res.statusText)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf("\n\n")
      while (index >= 0) {
        const raw = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const event = parseSse(raw)
        if (event) yield event
        index = buffer.indexOf("\n\n")
      }
    }
  }
}

function parseSse(raw: string): WireEvent | undefined {
  if (!raw.trim() || raw.startsWith(":")) return undefined
  let data = ""
  for (const line of raw.split("\n")) {
    if (line.startsWith("data: ")) data += line.slice(6)
  }
  if (!data) return undefined
  return JSON.parse(data) as WireEvent
}
