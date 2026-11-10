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

  updateConfig(patch: {
    model?: string
    preset?: string
    provider?: string
    baseUrl?: string
    apiKey?: string
  }) {
    return this.request<void>("configUpdate", {}, { method: "PATCH", body: JSON.stringify(patch) })
  }

  agents(directory?: string) {
    return this.request<Array<Record<string, unknown>>>("agents", {}, { query: { directory } })
  }

  commands(directory?: string) {
    return this.request<Array<Record<string, unknown>>>("commands", {}, { query: { directory } })
  }

  skills(directory?: string) {
    return this.request<Array<Record<string, unknown>>>("skills", {}, { query: { directory } })
  }

  tools(mode?: string, directory?: string) {
    return this.request<Array<Record<string, unknown>>>("tools", {}, { query: { mode, directory } })
  }

  location(directory?: string) {
    return this.request<Record<string, unknown>>("location", {}, { query: { directory } })
  }

  reloadLocation() {
    return this.request<void>("locationReload", {}, { method: "POST" })
  }

  debugLocations() {
    return this.request<Array<{ directory: string; model?: string }>>("debugLocations")
  }

  evictLocation(directory: string, model?: string) {
    return this.request<void>("debugEvict", {}, { method: "DELETE", query: { directory, model } })
  }

  fsList(path?: string, directory?: string) {
    return this.request<Array<{ path: string; type: string }>>("fsList", {}, { query: { path, directory } })
  }

  async fsRead(path: string, directory?: string): Promise<string> {
    const url = new URL(this.url + routePath("fsRead", { "*": path }))
    if (directory) url.searchParams.set("directory", directory)
    const res = await this.fetchImpl(url, { headers: { authorization: `Bearer ${this.token}` } })
    if (!res.ok) {
      const parsed = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } }
      throw new NexusApiError(res.status, parsed.error?.code ?? "internal", parsed.error?.message ?? res.statusText)
    }
    return res.text()
  }

  fsFind(query: string, opts: { type?: "file" | "directory"; limit?: number; directory?: string } = {}) {
    return this.request<Array<{ path: string; type: string }>>("fsFind", {}, { query: { query, ...opts } })
  }

  fsWrite(path: string, content: string, directory?: string) {
    return this.request<{ path: string }>(
      "fsWrite",
      {},
      { body: content, headers: { "content-type": "text/plain" }, query: { path, directory } },
    )
  }

  mcpServers(directory?: string) {
    return this.request<Array<Record<string, unknown>>>("mcpList", {}, { query: { directory } })
  }

  mcpAdd(server: string, config: Record<string, unknown>, directory?: string) {
    return this.request<void>(
      "mcpAdd",
      { server },
      { body: JSON.stringify({ config }), query: { directory } },
    )
  }

  mcpRemove(server: string, directory?: string) {
    return this.request<void>("mcpRemove", { server }, { query: { directory } })
  }

  mcpConnect(server: string, directory?: string) {
    return this.request<void>("mcpConnect", { server }, { method: "POST", query: { directory } })
  }

  mcpDisconnect(server: string, directory?: string) {
    return this.request<void>("mcpDisconnect", { server }, { method: "POST", query: { directory } })
  }

  mcpResources(directory?: string) {
    return this.request<Record<string, unknown>>("mcpResources", {}, { query: { directory } })
  }

  mcpReadResource(server: string, uri: string, directory?: string) {
    return this.request<unknown>("mcpResourceRead", { server }, { query: { uri, directory } })
  }

  ptyList(directory?: string) {
    return this.request<Array<Record<string, unknown>>>("ptyList", {}, { query: { directory } })
  }

  ptyCreate(body: Record<string, unknown> = {}, directory?: string) {
    return this.request<Record<string, unknown>>("ptyCreate", {}, { body: JSON.stringify(body), query: { directory } })
  }

  ptyGet(ptyID: string, directory?: string) {
    return this.request<Record<string, unknown>>("ptyGet", { ptyID }, { query: { directory } })
  }

  ptyUpdate(ptyID: string, body: Record<string, unknown>, directory?: string) {
    return this.request<Record<string, unknown>>("ptyUpdate", { ptyID }, { method: "PUT", body: JSON.stringify(body), query: { directory } })
  }

  ptyRemove(ptyID: string, directory?: string) {
    return this.request<void>("ptyRemove", { ptyID }, { query: { directory } })
  }

  ptyInput(ptyID: string, data: string) {
    return this.request<void>("ptyInput", { ptyID }, { body: JSON.stringify({ data }) })
  }

  ptyOutput(ptyID: string, offset?: number, directory?: string) {
    return this.request<{ data: string; offset: number }>("ptyOutput", { ptyID }, { query: { offset, directory } })
  }

  ptyConnectToken(ptyID: string) {
    return this.request<{ ticket: string; expires_in: number }>("ptyConnectToken", { ptyID }, { method: "POST" })
  }

  persistentPtyRead(sessionID: string, lines?: number, directory?: string) {
    return this.request<Record<string, unknown> | null>("persistentPtyRead", { sessionID }, { query: { lines, directory } })
  }

  persistentPtySnapshot(ptyID: string, directory?: string) {
    return this.request<Record<string, unknown>>("persistentPtySnapshot", { ptyID }, { query: { directory } })
  }

  persistentPtyShutdown() {
    return this.request<void>("persistentPtyShutdown", {}, { method: "POST" })
  }

  persistentPtyHandoff() {
    return this.request<{ handoff: null }>("persistentPtyHandoff", {}, { method: "POST" })
  }

  persistentPtyUpdate(ptyID: string, body: Record<string, unknown>, directory?: string) {
    return this.request<Record<string, unknown>>(
      "persistentPtyUpdate",
      { ptyID },
      { method: "PUT", body: JSON.stringify(body), query: { directory } },
    )
  }

  persistentPtyConnectToken(ptyID: string) {
    return this.request<{ ticket: string; expires_in: number }>(
      "persistentPtyConnectToken",
      { ptyID },
      { method: "POST" },
    )
  }

  /** Open a ticket-authenticated PTY socket. Resize with `ptyResize` on the returned socket. */
  ptyConnect(ptyID: string, ticket: string, cursor = 0): WebSocket {
    return this.websocket("ptyConnect", { ptyID }, ticket, cursor)
  }

  persistentPtyConnect(ptyID: string, ticket: string, cursor = 0): WebSocket {
    return this.websocket("persistentPtyConnect", { ptyID }, ticket, cursor)
  }

  private websocket(name: RouteName, params: Record<string, string>, ticket: string, cursor: number): WebSocket {
    const url = new URL(this.url + routePath(name, params))
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    url.searchParams.set("ticket", ticket)
    if (cursor > 0) url.searchParams.set("cursor", String(cursor))
    return new WebSocket(url)
  }

  /** Send a resize frame understood by the Nexus PTY socket. */
  ptyResize(socket: WebSocket, cols: number, rows: number): void {
    socket.send(JSON.stringify({ type: "resize", cols, rows }))
  }

  pluginList() {
    return this.request<Array<Record<string, unknown>>>("pluginList")
  }

  pluginCheck() {
    return this.request<Array<Record<string, unknown>>>("pluginCheck", {}, { method: "POST" })
  }

  pluginUpdate() {
    return this.request<Array<Record<string, unknown>>>("pluginUpdate", {}, { method: "POST" })
  }

  projectList() {
    return this.request<Array<Record<string, unknown>>>("projectList")
  }

  projectUpdate(projectID: string, patch: Record<string, unknown>) {
    return this.request<Record<string, unknown>>("projectUpdate", { projectID }, { body: JSON.stringify(patch) })
  }

  referenceList(directory?: string) {
    return this.request<Array<Record<string, unknown>>>("referenceList", {}, { query: { directory } })
  }

  formList(directory?: string) {
    return this.request<Array<Record<string, unknown>>>("formList", {}, { query: { directory } })
  }

  generate(prompt: string, model?: string) {
    return this.request<{ text: string }>("generate", {}, { body: JSON.stringify({ prompt, model }) })
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

  prompt(
    sessionID: string,
    body: {
      text: string
      images?: unknown[]
      autoApprove?: boolean
      mode?: string
      skills?: unknown[]
      agent?: { prompt?: string; tools?: string[]; mode?: string }
    },
  ) {
    return this.request<{ cursor: number; queued?: boolean } & Record<string, unknown>>(
      "prompt",
      { sessionID },
      { body: JSON.stringify(body) },
    )
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
