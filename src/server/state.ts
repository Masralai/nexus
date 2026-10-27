import { randomBytes } from "node:crypto"
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/** Version reported by the local service. Keep in sync with the CLI banner. */
export const SERVER_VERSION = "0.1.0"

export interface ServiceInfo {
  id: string
  version: string
  url: string
  pid: number
  password: string
  startedAt: string
}

/** State shared by `nexus serve`, discovery, and the future service commands. */
export function defaultStateDir(): string {
  return process.env.NEXUS_STATE_DIR || join(homedir(), ".nexus")
}

export function serviceInfoPath(dir = defaultStateDir()): string {
  return join(dir, "service.json")
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url")
}

export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM means the process exists but belongs to another user.
    return (e as NodeJS.ErrnoException).code === "EPERM"
  }
}

function isServiceInfo(value: unknown): value is ServiceInfo {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === "string" &&
    typeof v.version === "string" &&
    typeof v.url === "string" &&
    typeof v.pid === "number" &&
    typeof v.password === "string" &&
    typeof v.startedAt === "string"
  )
}

/** Read the registration written by the running server. Corrupt files read as absent. */
export function readServiceInfo(dir = defaultStateDir()): ServiceInfo | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(serviceInfoPath(dir), "utf8"))
    return isServiceInfo(parsed) ? parsed : undefined
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined
    return undefined
  }
}

/** Atomic, owner-only registration. The password never leaves this file except in memory. */
export function writeServiceInfo(info: ServiceInfo, dir = defaultStateDir()): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = serviceInfoPath(dir)
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
  writeFileSync(temp, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 })
  chmodSync(temp, 0o600)
  renameSync(temp, path)
  return path
}

/** Remove registration only when it still belongs to this process. */
export function removeServiceInfo(info: Pick<ServiceInfo, "pid">, dir = defaultStateDir()): void {
  const current = readServiceInfo(dir)
  if (!current || current.pid !== info.pid) return
  rmSync(serviceInfoPath(dir), { force: true })
}

/** Discover a live registration, cleaning up stale pid files. */
export function discoverService(dir = defaultStateDir()): ServiceInfo | undefined {
  const info = readServiceInfo(dir)
  if (!info) return undefined
  if (processAlive(info.pid)) return info
  removeServiceInfo(info, dir)
  return undefined
}

/** Wait until a live registration appears, or throw. */
export async function waitForService(
  dir = defaultStateDir(),
  timeoutMs = 8_000,
): Promise<ServiceInfo> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const info = discoverService(dir)
    if (info) return info
    await Bun.sleep(50)
  }
  throw new Error(`timed out waiting for nexus service in ${dir}`)
}

/** A loopback URL even when the listener binds all interfaces. */
export function advertisedUrl(hostname: string, port: number): string {
  const host = hostname === "0.0.0.0" || hostname === "::" || hostname === "[::]" ? "127.0.0.1" : hostname
  return `http://${host}:${port}`
}
