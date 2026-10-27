import { resolve } from "node:path"
import { launchRuntime } from "../cli/launch"
import type { NexusConfig } from "../cli/config"
import { openSessionStore, type SQLiteStore } from "../engine/store"
import { createRouter } from "./router"
import { SessionService, type RuntimeFactory } from "./service"
import { advertisedUrl, generateToken } from "./state"

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
}

export interface ServerHandle {
  server: ReturnType<typeof Bun.serve>
  service: SessionService
  store: SQLiteStore
  token: string
  url: string
  startedAt: string
  stop(): Promise<void>
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
  const version = options.version ?? "0.1.0"
  const startedAt = new Date().toISOString()
  let url = ""

  const fetch = createRouter({
    service,
    token,
    config: options.config,
    info: () => ({ version, url, pid: process.pid, startedAt }),
  })

  const server = Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 4096,
    fetch,
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

  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    await service.shutdown()
    server.stop(true)
    if (ownsStore) store.close()
  }

  return { server, service, store, token, url, startedAt, stop }
}
