import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export interface CredentialEntry {
  apiKey: string
  baseUrl?: string
}

export type CredentialsFile = Record<string, CredentialEntry>

export function defaultCredentialsPath(): string {
  return join(homedir(), ".nexus", "credentials.json")
}

export function loadCredentials(path = defaultCredentialsPath()): CredentialsFile {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"))
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {}
    return raw as CredentialsFile
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw new Error(`${path}: ${(e as Error).message}`)
  }
}

export function saveCredentials(creds: CredentialsFile, path = defaultCredentialsPath()): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 })
}

export function setCredential(
  presetId: string,
  entry: CredentialEntry,
  path = defaultCredentialsPath(),
): void {
  const all = loadCredentials(path)
  all[presetId] = entry
  saveCredentials(all, path)
}

export function getCredential(presetId: string, path = defaultCredentialsPath()): CredentialEntry | undefined {
  return loadCredentials(path)[presetId]
}

/** True if path exists (even empty object). */
export function credentialsFileExists(path = defaultCredentialsPath()): boolean {
  return existsSync(path)
}
