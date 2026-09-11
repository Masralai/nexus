import { chmodSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const HISTORY_LIMIT = 100

export function defaultHistoryPath(): string {
  // Allow override for tests (like config/credentials).
  const env = process.env.NEXUS_HISTORY_PATH
  if (env) return env
  return join(homedir(), ".nexus", "history")
}

function parseLine(raw: string): string | null {
  if (raw.length === 0) return null
  try {
    const v = JSON.parse(raw)
    if (typeof v === "string") return v
    // Fallback: legacy plain line was stored without JSON encoding
    return raw
  } catch {
    return raw
  }
}

export function loadHistory(path = defaultHistoryPath(), limit = HISTORY_LIMIT): string[] {
  try {
    const txt = readFileSync(path, "utf8")
    const lines = txt.split("\n").filter((l) => l.length > 0)
    const out: string[] = []
    for (const l of lines) {
      const v = parseLine(l)
      if (v !== null && v.length > 0) out.push(v)
    }
    if (out.length > limit) return out.slice(out.length - limit)
    return out
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return []
    // Corrupt / unreadable → treat as empty rather than crash TUI.
    return []
  }
}

export function writeHistory(history: string[], path = defaultHistoryPath()): void {
  const capped = history.length > HISTORY_LIMIT ? history.slice(history.length - HISTORY_LIMIT) : history
  mkdirSync(dirname(path), { recursive: true })
  const body = capped.map((s) => JSON.stringify(s)).join("\n") + (capped.length ? "\n" : "")
  writeFileSync(path, body, { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    /* best-effort: filesystem may not support chmod (e.g., Windows) */
  }
}

export function appendHistory(line: string, path = defaultHistoryPath()): string[] {
  const trimmed = line.trim()
  if (!trimmed) return loadHistory(path)
  const hist = loadHistory(path)
  if (hist[hist.length - 1] === trimmed) return hist // consecutive dedup
  const next = [...hist, trimmed]
  const capped = next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
  writeHistory(capped, path)
  return capped
}
