import { homedir } from "node:os"
import { join } from "node:path"
import { SQLiteStore } from "./sqlite"

export { SQLiteStore } from "./sqlite"
export { partsForMessage } from "./sqlite"
export type { PartRecord } from "./sqlite"
export type { SessionStore } from "./types"

export function defaultDbPath(): string {
  return process.env.NEXUS_DB || join(homedir(), ".nexus", "nexus.db")
}

export function defaultLegacySessionsDir(): string {
  return join(homedir(), ".nexus", "sessions")
}

export interface OpenStoreOptions {
  dbPath?: string
}

/** Open the durable session store. Legacy JSONL is imported by `nexus migrate`. */
export function openSessionStore(opts: OpenStoreOptions = {}): SQLiteStore {
  return new SQLiteStore({ path: opts.dbPath ?? defaultDbPath() })
}
