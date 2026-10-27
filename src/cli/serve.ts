import { join } from "node:path"
import { startServer } from "../server/server"
import { defaultStateDir, generateToken } from "../server/state"

export interface ServeFlags {
  hostname: string
  port: number
  token: string
  stateDir: string
}

export function parseServeFlags(argv: string[]): ServeFlags {
  const take = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const portRaw = take("--port") ?? process.env.NEXUS_PORT ?? "4096"
  const port = Number(portRaw)
  if (!Number.isInteger(port) || port < 0) throw new Error(`invalid --port ${portRaw}`)
  return {
    hostname: take("--hostname") ?? process.env.NEXUS_HOSTNAME ?? "127.0.0.1",
    port,
    token: take("--token") ?? process.env.NEXUS_SERVER_TOKEN ?? generateToken(),
    stateDir: take("--state-dir") ?? defaultStateDir(),
  }
}

/** Foreground local server. Registers `service.json` for attach and managed commands. */
export async function runServe(flags: ServeFlags): Promise<void> {
  const handle = await startServer({
    hostname: flags.hostname,
    port: flags.port,
    token: flags.token,
    register: true,
    stateDir: flags.stateDir,
    dbPath: process.env.NEXUS_DB ?? join(flags.stateDir, "nexus.db"),
  })
  const stop = async () => {
    await handle.stop()
    process.exit(0)
  }
  process.once("SIGINT", () => void stop())
  process.once("SIGTERM", () => void stop())
  console.error(`nexus server ${handle.url}`)
  console.error(`token: ${flags.stateDir}/service.json`)
  await new Promise(() => {})
}
