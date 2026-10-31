import { readFileSync, writeFileSync } from "node:fs"
import { sessionToMarkdown } from "../engine/session-io"
import { openSessionStore, type SQLiteStore } from "../engine/store"

export interface SessionCommandOptions {
  store?: SQLiteStore
  write?: (text: string) => void
  error?: (text: string) => void
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

/** First bare argument, skipping values that belong to known flags. */
function positional(argv: string[], flags: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (flags.includes(arg)) {
      i++
      continue
    }
    if (!arg.startsWith("--")) return arg
  }
  return undefined
}

export function exportSession(argv: string[], opts: SessionCommandOptions = {}): number {
  const write = opts.write ?? ((text: string) => process.stdout.write(text))
  const error = opts.error ?? ((text: string) => console.error(text))
  const id = positional(argv, ["--format", "--out"])
  if (!id) {
    error("usage: nexus export <session-id> [--format json|markdown] [--out <file>]")
    return 1
  }
  const format = option(argv, "--format")
  const markdown = format === "markdown" || format === "md"
  const out = option(argv, "--out")
  const store = opts.store ?? openSessionStore()
  try {
    const doc = store.exportSession(id)
    const body = markdown ? sessionToMarkdown(doc) : `${JSON.stringify(doc, null, 2)}\n`
    if (out) {
      writeFileSync(out, body)
      write(`exported ${id} -> ${out}\n`)
    } else {
      write(body)
    }
    return 0
  } catch (cause) {
    error(cause instanceof Error ? cause.message : String(cause))
    return 1
  } finally {
    if (!opts.store) store.close()
  }
}

export function importSession(argv: string[], opts: SessionCommandOptions = {}): number {
  const write = opts.write ?? ((text: string) => process.stdout.write(text))
  const error = opts.error ?? ((text: string) => console.error(text))
  const file = positional(argv, [])
  if (!file) {
    error("usage: nexus import <export.json>")
    return 1
  }
  const store = opts.store ?? openSessionStore()
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown
    const result = store.importSession(raw)
    write(result.imported ? `imported ${result.meta.id}\n` : `skipped ${result.meta.id} (already present)\n`)
    return 0
  } catch (cause) {
    error(cause instanceof Error ? cause.message : String(cause))
    return 1
  } finally {
    if (!opts.store) store.close()
  }
}

export function revertSession(argv: string[], opts: SessionCommandOptions = {}): number {
  const write = opts.write ?? ((text: string) => process.stdout.write(text))
  const error = opts.error ?? ((text: string) => console.error(text))
  const id = positional(argv, ["--at"])
  if (!id) {
    error("usage: nexus revert <session-id> [--at <message-id>]")
    return 1
  }
  const store = opts.store ?? openSessionStore()
  try {
    const messageID = option(argv, "--at")
    const removed = store.revertTo(id, messageID)
    if (removed === 0) {
      error(messageID ? `message ${messageID} not found in ${id}` : `session ${id} has nothing to revert`)
      return 1
    }
    store.setStatus(id, "done")
    store.appendEvent(id, { type: "sessionReverted", ...(messageID ? { messageID } : {}), removed })
    write(`reverted ${id} (${removed} part${removed === 1 ? "" : "s"} removed)\n`)
    return 0
  } catch (cause) {
    error(cause instanceof Error ? cause.message : String(cause))
    return 1
  } finally {
    if (!opts.store) store.close()
  }
}

export function forkSession(argv: string[], opts: SessionCommandOptions = {}): number {
  const write = opts.write ?? ((text: string) => process.stdout.write(text))
  const error = opts.error ?? ((text: string) => console.error(text))
  const id = positional(argv, ["--at", "--title"])
  if (!id) {
    error("usage: nexus fork <session-id> [--at <message-id>] [--title <title>]")
    return 1
  }
  const store = opts.store ?? openSessionStore()
  try {
    const messageID = option(argv, "--at")
    const title = option(argv, "--title")
    const meta = store.fork(id, {
      ...(messageID ? { boundary: messageID } : {}),
      ...(title ? { title } : {}),
    })
    store.appendEvent(meta.id, {
      type: "sessionForked",
      parentID: id,
      ...(messageID ? { messageID } : {}),
    })
    write(`${meta.id}\n`)
    return 0
  } catch (cause) {
    error(cause instanceof Error ? cause.message : String(cause))
    return 1
  } finally {
    if (!opts.store) store.close()
  }
}
