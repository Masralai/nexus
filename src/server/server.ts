import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { launchRuntime } from "../cli/launch"
import type { NexusConfig } from "../cli/config"
import type { PtyInfo } from "../engine/types"
import { openSessionStore, type SQLiteStore } from "../engine/store"
import { MemoryPtyTickets, type PtyTicketStore } from "./pty-ticket"
import { createRouter } from "./router"
import { SessionService, type RuntimeFactory } from "./service"
import {
  advertisedUrl,
  generateToken,
  removeServiceInfo,
  writeServiceInfo,
  type ServiceInfo,
} from "./state"

export interface StartServerOptions {
  store?: SQLiteStore
  dbPath?: string
  defaultCwd?: string
  hostname?: string
  port?: number
  token?: string
  runtimeFactory?: RuntimeFactory
  config?: NexusConfig
  version?: string
  /** Write `service.json` so clients can discover this process. */
  register?: boolean
  stateDir?: string
  /** Override the single-use WebSocket ticket store (tests, shared process). */
  tickets?: PtyTicketStore
  /** Override global config and credentials paths (tests, isolated clients). */
  configPath?: string
  credentialsPath?: string
}

export interface ServerHandle {
  server: ReturnType<typeof Bun.serve>
  service: SessionService
  store: SQLiteStore
  token: string
  url: string
  startedAt: string
  tickets: PtyTicketStore
  stop(): Promise<void>
}

interface PtySocketData {
  ptyID: string
  cursor: number
  timer?: ReturnType<typeof setInterval>
}

interface LivePty {
  get(id: string): PtyInfo | undefined
  output(id: string, offset?: number): { data: string; offset: number }
  write(id: string, data: string): void
  update(id: string, opts: { title?: string; rows?: number; cols?: number }): PtyInfo
}

function ptyConnectID(url: URL): string | undefined {
  const direct = /^\/api\/pty\/([^/]+)\/connect$/.exec(url.pathname)
  if (direct) return decodeURIComponent(direct[1])
  const persistent = /^\/api\/experimental\/persistent-pty\/([^/]+)\/connect$/.exec(url.pathname)
  if (persistent) return decodeURIComponent(persistent[1])
  return undefined
}

/**
 * Start the local HTTP server. The store and runtime factory are injectable so
 * the HTTP seam can be tested without a provider key or a real home directory.
 */
export async function startServer(options: StartServerOptions = {}): Promise<ServerHandle> {
  const ownsStore = !options.store
  const store = options.store ?? openSessionStore({ dbPath: options.dbPath })
  const defaultCwd = resolve(options.defaultCwd ?? process.cwd())
  const runtimeFactory: RuntimeFactory =
    options.runtimeFactory ??
    ((input) => launchRuntime({ cwd: input.cwd, model: input.model, store: input.store }))
  const service = new SessionService({ store, defaultCwd, runtimeFactory })
  const token = options.token ?? generateToken()
  const tickets = options.tickets ?? new MemoryPtyTickets()
  const version = options.version ?? "0.1.0"
  const startedAt = new Date().toISOString()
  let url = ""

  const fetch = createRouter({
    service,
    token,
    config: options.config,
    defaultCwd,
    tickets,
    configPath: options.configPath,
    credentialsPath: options.credentialsPath,
    info: () => ({
      version,
      url,
      urls: [url],
      pid: process.pid,
      startedAt,
      paths: { tmp: process.env.TMPDIR ?? "/tmp" },
    }),
  })

  const pty = (): LivePty | undefined => {
    const control = service.defaultWorkspace().controls?.pty
    if (!control?.get || !control.output || !control.write || !control.update) return undefined
    return control as LivePty
  }
  const server = Bun.serve<PtySocketData>({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 4096,
    async fetch(req, bun) {
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const ptyID = ptyConnectID(new URL(req.url))
        if (ptyID) {
          const ticket = new URL(req.url).searchParams.get("ticket") ?? ""
          if (!tickets.redeem(ptyID, ticket)) {
            return new Response(JSON.stringify({ error: { code: "forbidden", message: "invalid or used ticket" } }), {
              status: 403,
              headers: { "content-type": "application/json; charset=utf-8" },
            })
          }
          if (!pty()?.get(ptyID)) {
            return new Response(JSON.stringify({ error: { code: "not_found", message: `pty ${ptyID} not found` } }), {
              status: 404,
              headers: { "content-type": "application/json; charset=utf-8" },
            })
          }
          const cursor = Number(new URL(req.url).searchParams.get("cursor") ?? 0)
          const data: PtySocketData = { ptyID, cursor: Number.isFinite(cursor) && cursor > 0 ? cursor : 0 }
          if (bun.upgrade(req, { data })) return undefined
          return new Response("websocket upgrade failed", { status: 400 })
        }
      }
      return fetch(req)
    },
    websocket: {
      open(ws) {
        const data = ws.data
        const control = pty()
        if (!control) {
          ws.close()
          return
        }
        const flush = () => {
          try {
            const out = control.output(data.ptyID, data.cursor)
            if (!out.data) return
            data.cursor = out.offset
            ws.send(out.data)
          } catch {
            ws.close()
          }
        }
        flush()
        // ponytail: 50ms polling reuses PtyManager's buffer; add pub/sub if latency matters.
        data.timer = setInterval(flush, 50)
      },
      message(ws, message) {
        const data = ws.data
        const control = pty()
        if (!control) return
        const text = typeof message === "string" ? message : new TextDecoder().decode(message)
        try {
          const frame = JSON.parse(text) as { type?: string; data?: string; cols?: number; rows?: number; cursor?: number }
          if (frame?.type === "input" && typeof frame.data === "string") {
            control.write(data.ptyID, frame.data)
            return
          }
          if (frame?.type === "resize" && typeof frame.cols === "number" && typeof frame.rows === "number") {
            control.update(data.ptyID, { cols: Math.floor(frame.cols), rows: Math.floor(frame.rows) })
            return
          }
          if (frame?.type === "cursor" && typeof frame.cursor === "number") {
            data.cursor = Math.max(0, Math.floor(frame.cursor))
            return
          }
        } catch {
          /* raw terminal input */
        }
        control.write(data.ptyID, text)
      },
      close(ws) {
        const data = ws.data
        if (data.timer) clearInterval(data.timer)
      },
    },
    error(error) {
      return new Response(
        JSON.stringify({ error: { code: "internal", message: error instanceof Error ? error.message : String(error) } }),
        { status: 500, headers: { "content-type": "application/json; charset=utf-8" } },
      )
    },
  })
  url = advertisedUrl(
    server.hostname ?? options.hostname ?? "127.0.0.1",
    server.port ?? options.port ?? 4096,
  )

  let registration: ServiceInfo | undefined
  if (options.register) {
    registration = {
      id: randomUUID(),
      version,
      url,
      pid: process.pid,
      password: token,
      startedAt,
    }
    writeServiceInfo(registration, options.stateDir)
  }

  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    if (registration) removeServiceInfo(registration, options.stateDir)
    await service.shutdown()
    server.stop(true)
    if (ownsStore) store.close()
  }

  return { server, service, store, token, url, startedAt, tickets, stop }
}
