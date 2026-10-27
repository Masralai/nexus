import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  defaultStateDir,
  discoverService,
  processAlive,
  removeServiceInfo,
  waitForService,
  type ServiceInfo,
} from "../server/state"

export function serviceStateDir(argv: string[]): string {
  const i = argv.indexOf("--state-dir")
  return (i >= 0 ? argv[i + 1] : undefined) ?? defaultStateDir()
}

function serveArgv(extra: string[]): string[] {
  const main = join(import.meta.dir, "main.ts")
  if (existsSync(main)) return [process.execPath, main, "serve", ...extra]
  return [process.execPath, "serve", ...extra]
}

export async function startManagedService(opts: {
  stateDir?: string
  port?: number
  hostname?: string
  token?: string
}): Promise<ServiceInfo> {
  const stateDir = opts.stateDir ?? defaultStateDir()
  const existing = discoverService(stateDir)
  if (existing) return existing
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const extra: string[] = ["--state-dir", stateDir]
  if (opts.port !== undefined) extra.push("--port", String(opts.port))
  if (opts.hostname) extra.push("--hostname", opts.hostname)
  if (opts.token) extra.push("--token", opts.token)
  const logPath = join(stateDir, "serve.log")
  const out = Bun.file(logPath)
  const child = Bun.spawn(serveArgv(extra), {
    stdout: out,
    stderr: out,
    stdin: "ignore",
    env: { ...process.env, NEXUS_STATE_DIR: stateDir },
  })
  try {
    const info = await waitForService(stateDir)
    child.unref()
    return info
  } catch (error) {
    child.kill()
    let details = ""
    try {
      details = readFileSync(logPath, "utf8")
    } catch {
      // No log yet.
    }
    throw new Error(`${error instanceof Error ? error.message : error}${details ? `\n${details}` : ""}`)
  }
}

export async function stopManagedService(stateDir = defaultStateDir()): Promise<boolean> {
  const info = discoverService(stateDir)
  if (!info) return false
  if (processAlive(info.pid)) {
    try {
      process.kill(info.pid, "SIGTERM")
    } catch {
      // Already gone.
    }
    const deadline = Date.now() + 3_000
    while (Date.now() < deadline && processAlive(info.pid)) await Bun.sleep(50)
    if (processAlive(info.pid)) {
      try {
        process.kill(info.pid, "SIGKILL")
      } catch {
        // Ignore.
      }
    }
  }
  removeServiceInfo(info, stateDir)
  return true
}

export async function runService(argv: string[]): Promise<number> {
  const cmd = argv[0] ?? "status"
  const rest = argv.slice(1)
  const stateDir = serviceStateDir(rest)
  const take = (flag: string): string | undefined => {
    const i = rest.indexOf(flag)
    return i >= 0 ? rest[i + 1] : undefined
  }
  switch (cmd) {
    case "start": {
      const info = await startManagedService({
        stateDir,
        port: take("--port") ? Number(take("--port")) : undefined,
        hostname: take("--hostname"),
        token: take("--token"),
      })
      console.log(JSON.stringify({ url: info.url, pid: info.pid, version: info.version }))
      return 0
    }
    case "stop": {
      const stopped = await stopManagedService(stateDir)
      if (!stopped) {
        console.error("nexus service is not running")
        return 1
      }
      return 0
    }
    case "status": {
      const info = discoverService(stateDir)
      if (!info) {
        console.log(JSON.stringify({ running: false }))
        return 1
      }
      console.log(JSON.stringify({ running: true, url: info.url, pid: info.pid, version: info.version }))
      return 0
    }
    case "token": {
      const info = discoverService(stateDir)
      if (!info) {
        console.error("nexus service is not running")
        return 1
      }
      console.log(info.password)
      return 0
    }
    default:
      console.error(`usage: nexus service <start|stop|status|token>`)
      return 1
  }
}
