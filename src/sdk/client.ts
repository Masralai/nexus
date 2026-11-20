import {
  ROUTES,
  routePath,
  type ResponseOf,
  type RouteDefinition,
  type RouteInit,
  type RouteName,
} from "../server/contract"
import type { WireEvent } from "../server/service"
import { createRouteSurface, type RouteParams } from "./generated"

export { ROUTES, routePath }
export type { ResponseOf, RouteInit, RouteName, RouteParams, WireEvent }

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
 *
 * `api` is generated from the contract: one method per JSON route, with path
 * parameters parsed from the path pattern and responses from `RouteResponses`.
 * The methods below it are ergonomic wrappers over that surface.
 */
export class NexusClient {
  readonly url: string
  readonly token: string
  readonly api: ReturnType<typeof createRouteSurface>
  private readonly fetchImpl: typeof fetch

  constructor(options: NexusClientOptions) {
    this.url = options.url.replace(/\/+$/, "")
    this.token = options.token
    this.fetchImpl = options.fetch ?? fetch
    this.api = createRouteSurface((name, params, init) => this.request(name, params, init))
  }

  async request<N extends RouteName>(name: N, params: RouteParams[N], init: RouteInit = {}): Promise<ResponseOf<N>> {
    const route = ROUTES[name]
    const url = new URL(this.url + routePath(name, params as Record<string, string>))
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
    if (res.status === 204) return undefined as ResponseOf<N>
    if ((route as RouteDefinition).wire === "text") {
      if (!res.ok) throw await failure(res)
      return (await res.text()) as ResponseOf<N>
    }
    const parsed = (await res.json()) as { data?: ResponseOf<N>; error?: { code: string; message: string } }
    if (!res.ok) {
      throw new NexusApiError(res.status, parsed.error?.code ?? "internal", parsed.error?.message ?? res.statusText)
    }
    return parsed.data as ResponseOf<N>
  }

  info() {
    return this.api.info()
  }

  config() {
    return this.api.config()
  }

  /** Effective config (live) for clients that need commands/agents/model without local reads. */
  effectiveConfig(_directory?: string) {
    return this.config()
  }

  modelDefault() {
    return this.api.modelDefault()
  }

  updateConfig(patch: {
    model?: string
    preset?: string
    provider?: string
    baseUrl?: string
    apiKey?: string
  }) {
    return this.api.configUpdate({ body: JSON.stringify(patch) })
  }

  verifyProvider(input: { preset: string; apiKey: string; baseUrl?: string; model?: string }) {
    return this.api.providerVerify({ body: JSON.stringify(input) })
  }

  providers() {
    return this.api.providers({})
  }

  agents(directory?: string) {
    return this.api.agents({ query: { directory } })
  }

  commands(directory?: string) {
    return this.api.commands({ query: { directory } })
  }

  skills(directory?: string) {
    return this.api.skills({ query: { directory } })
  }

  tools(mode?: string, directory?: string) {
    return this.api.tools({ query: { mode, directory } })
  }

  location(directory?: string) {
    return this.api.location({ query: { directory } })
  }

  reloadLocation() {
    return this.api.locationReload({})
  }

  debugLocations() {
    return this.api.debugLocations({})
  }

  evictLocation(directory: string, model?: string) {
    return this.api.debugEvict({ query: { directory, model } })
  }

  fsList(path?: string, directory?: string) {
    return this.api.fsList({ query: { path, directory } })
  }

  fsRead(path: string, directory?: string) {
    return this.api.fsRead({ "*": path }, { query: { directory } })
  }

  fsFind(query: string, opts: { type?: "file" | "directory"; limit?: number; directory?: string } = {}) {
    return this.api.fsFind({ query: { query, ...opts } })
  }

  fsWrite(path: string, content: string, directory?: string) {
    return this.api.fsWrite({ body: content, headers: { "content-type": "text/plain" }, query: { path, directory } })
  }

  mcpServers(directory?: string) {
    return this.api.mcpList({ query: { directory } })
  }

  mcpAdd(server: string, config: Record<string, unknown>, directory?: string) {
    return this.api.mcpAdd({ server }, { body: JSON.stringify({ config }), query: { directory } })
  }

  mcpRemove(server: string, directory?: string) {
    return this.api.mcpRemove({ server }, { query: { directory } })
  }

  mcpConnect(server: string, directory?: string) {
    return this.api.mcpConnect({ server }, { query: { directory } })
  }

  mcpDisconnect(server: string, directory?: string) {
    return this.api.mcpDisconnect({ server }, { query: { directory } })
  }

  mcpResources(directory?: string) {
    return this.api.mcpResources({ query: { directory } })
  }

  mcpReadResource(server: string, uri: string, directory?: string) {
    return this.api.mcpResourceRead({ server }, { query: { uri, directory } })
  }

  ptyList(directory?: string) {
    return this.api.ptyList({ query: { directory } })
  }

  ptyCreate(body: Record<string, unknown> = {}, directory?: string) {
    return this.api.ptyCreate({ body: JSON.stringify(body), query: { directory } })
  }

  ptyGet(ptyID: string, directory?: string) {
    return this.api.ptyGet({ ptyID }, { query: { directory } })
  }

  ptyUpdate(ptyID: string, body: Record<string, unknown>, directory?: string) {
    return this.api.ptyUpdate({ ptyID }, { body: JSON.stringify(body), query: { directory } })
  }

  ptyRemove(ptyID: string, directory?: string) {
    return this.api.ptyRemove({ ptyID }, { query: { directory } })
  }

  ptyInput(ptyID: string, data: string) {
    return this.api.ptyInput({ ptyID }, { body: JSON.stringify({ data }) })
  }

  ptyOutput(ptyID: string, offset?: number, directory?: string) {
    return this.api.ptyOutput({ ptyID }, { query: { offset, directory } })
  }

  ptyConnectToken(ptyID: string) {
    return this.api.ptyConnectToken({ ptyID })
  }

  persistentPtyRead(sessionID: string, lines?: number, directory?: string) {
    return this.api.persistentPtyRead({ sessionID }, { query: { lines, directory } })
  }

  persistentPtySnapshot(ptyID: string, directory?: string) {
    return this.api.persistentPtySnapshot({ ptyID }, { query: { directory } })
  }

  persistentPtyShutdown() {
    return this.api.persistentPtyShutdown({})
  }

  persistentPtyHandoff(sessionID: string) {
    return this.api.persistentPtyHandoff({ sessionID })
  }

  persistentPtyUpdate(ptyID: string, body: Record<string, unknown>, directory?: string) {
    return this.api.persistentPtyUpdate({ ptyID }, { body: JSON.stringify(body), query: { directory } })
  }

  persistentPtyConnectToken(ptyID: string) {
    return this.api.persistentPtyConnectToken({ ptyID })
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
    return this.api.pluginList({})
  }

  pluginCheck() {
    return this.api.pluginCheck({})
  }

  pluginUpdate() {
    return this.api.pluginUpdate({})
  }

  projectList() {
    return this.api.projectList({})
  }

  projectUpdate(projectID: string, patch: Record<string, unknown>) {
    return this.api.projectUpdate({ projectID }, { body: JSON.stringify(patch) })
  }

  referenceList(directory?: string) {
    return this.api.referenceList({ query: { directory } })
  }

  formList(directory?: string) {
    return this.api.formList({ query: { directory } })
  }

  generate(prompt: string, model?: string) {
    return this.api.generate({ body: JSON.stringify({ prompt, model }) })
  }

  listSessions(query?: string, limit?: number) {
    return this.api.sessions({ query: { search: query, limit } })
  }

  createSession(body: Record<string, unknown> = {}) {
    return this.api.sessionCreate({ body: JSON.stringify(body) })
  }

  getSession(sessionID: string) {
    return this.api.session({ sessionID })
  }

  renameSession(sessionID: string, title: string) {
    return this.api.sessionUpdate({ sessionID }, { body: JSON.stringify({ title }) })
  }

  deleteSession(sessionID: string) {
    return this.api.sessionDelete({ sessionID })
  }

  revertSession(sessionID: string, messageID?: string) {
    return this.api.sessionRevert({ sessionID }, { body: JSON.stringify(messageID ? { messageID } : {}) })
  }

  forkSession(sessionID: string, opts: { messageID?: string; title?: string } = {}) {
    return this.api.sessionFork({ sessionID }, { body: JSON.stringify(opts) })
  }

  exportSession(sessionID: string) {
    return this.api.sessionExport({ sessionID })
  }

  importSession(body: Record<string, unknown>) {
    return this.api.sessionImport({ body: JSON.stringify(body) })
  }

  sessionUsage(sessionID: string) {
    return this.api.sessionUsage({ sessionID })
  }

  messages(sessionID: string, limit?: number) {
    return this.api.messages({ sessionID }, { query: { limit } })
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
    return this.api.prompt({ sessionID }, { body: JSON.stringify(body) })
  }

  interrupt(sessionID: string) {
    return this.api.interrupt({ sessionID })
  }

  abort(sessionID: string) {
    return this.interrupt(sessionID)
  }

  replyPermission(sessionID: string, requestID: string, decision: boolean | "always" | "once" | "deny") {
    return this.api.permissionReply({ sessionID, requestID }, { body: JSON.stringify({ decision }) })
  }

  replyQuestion(sessionID: string, requestID: string, answers: unknown[]) {
    return this.api.questionReply({ sessionID, requestID }, { body: JSON.stringify({ answers }) })
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
    if (!res.ok || !res.body) throw await failure(res)
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

async function failure(res: Response): Promise<NexusApiError> {
  const parsed = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } }
  return new NexusApiError(res.status, parsed.error?.code ?? "internal", parsed.error?.message ?? res.statusText)
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
