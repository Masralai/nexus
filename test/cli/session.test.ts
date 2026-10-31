import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { exportSession, forkSession, importSession, revertSession } from "../../src/cli/session"
import { SQLiteStore } from "../../src/engine/sqlite"
import type { Message, SessionMeta } from "../../src/engine/types"

const meta: SessionMeta = {
  id: "ses_cli",
  cwd: "/tmp/project",
  model: "gpt-4o",
  provider: "openai-compatible",
  createdAt: "2026-10-22T00:00:00.000Z",
  title: "CLI session",
}

const history: Message[] = [
  { role: "user", content: "first" },
  { role: "assistant", content: "one" },
  { role: "user", content: "second" },
  { role: "assistant", content: "two" },
]

function fixtures(): { dir: string; store: SQLiteStore; out: string[]; err: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "nexus-cli-session-"))
  const store = new SQLiteStore({ path: join(dir, "nexus.db") })
  store.create(meta, history)
  store.setStatus(meta.id, "done")
  return { dir, store, out: [], err: [] }
}

test("export writes JSON and markdown", () => {
  const { dir, store, out, err } = fixtures()
  try {
    expect(
      exportSession([meta.id], { store, write: (text) => out.push(text), error: (text) => err.push(text) }),
    ).toBe(0)
    const doc = JSON.parse(out.join("")) as { schemaVersion: number; messages: unknown[] }
    expect(doc.schemaVersion).toBe(1)
    expect(doc.messages).toHaveLength(4)

    out.length = 0
    const file = join(dir, "session.md")
    expect(
      exportSession([meta.id, "--format", "markdown", "--out", file], {
        store,
        write: (text) => out.push(text),
        error: (text) => err.push(text),
      }),
    ).toBe(0)
    const markdown = readFileSync(file, "utf8")
    expect(markdown).toContain("# CLI session")
    expect(markdown).toContain("## user")
    expect(err).toEqual([])
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("import is idempotent and rejects malformed files", () => {
  const { dir, store, out, err } = fixtures()
  try {
    const first = join(dir, "export.json")
    exportSession([meta.id, "--out", first], { store, write: () => {}, error: () => {} })
    store.delete(meta.id)

    expect(importSession([first], { store, write: (text) => out.push(text), error: (text) => err.push(text) })).toBe(0)
    expect(out.join("")).toContain("imported ses_cli")
    expect(store.load(meta.id).messages).toEqual(history)

    out.length = 0
    expect(importSession([first], { store, write: (text) => out.push(text), error: (text) => err.push(text) })).toBe(0)
    expect(out.join("")).toContain("skipped ses_cli")

    const bad = join(dir, "bad.json")
    writeFileSync(bad, "{\"nope\":true}")
    expect(importSession([bad], { store, write: () => {}, error: (text) => err.push(text) })).toBe(1)
    expect(err.join("")).toContain("session metadata")
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("revert and fork operate from the CLI", () => {
  const { dir, store, out, err } = fixtures()
  try {
    const entries = store.messageEntries(meta.id)
    expect(
      forkSession([meta.id, "--at", entries[2].id, "--title", "Branch"], {
        store,
        write: (text) => out.push(text),
        error: (text) => err.push(text),
      }),
    ).toBe(0)
    const forkID = out.join("").trim()
    expect(store.load(forkID).messages).toEqual(history.slice(0, 2))
    expect(store.load(forkID).meta).toMatchObject({ parentId: meta.id, title: "Branch" })

    out.length = 0
    expect(
      revertSession([meta.id, "--at", entries[2].id], {
        store,
        write: (text) => out.push(text),
        error: (text) => err.push(text),
      }),
    ).toBe(0)
    expect(store.load(meta.id).messages).toEqual(history.slice(0, 2))
    expect(err).toEqual([])
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
