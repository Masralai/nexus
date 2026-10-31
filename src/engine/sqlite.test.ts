import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { JSONLStore } from "./state"
import { SQLiteStore, partsForMessage } from "./sqlite"
import type { Message, SessionMeta } from "./types"

function store(): SQLiteStore {
  const dir = mkdtempSync(join(tmpdir(), "nexus-db-"))
  return new SQLiteStore({ path: join(dir, "nexus.db") })
}

const meta: SessionMeta = {
  id: "s1",
  cwd: "/tmp/project",
  model: "gpt-4o",
  provider: "openai-compatible",
  createdAt: "2026-10-22T00:00:00.000Z",
}

const history: Message[] = [
  { role: "user", content: "fix the failing tests\nplease" },
  { role: "assistant", content: null, toolCalls: [{ id: "c1", name: "read", input: { path: "a.ts" } }] },
  { role: "tool", toolCallId: "c1", name: "read", result: { ok: true, output: "export const a = 1" } },
  { role: "assistant", content: "done" },
  { role: "user", content: "summary of prior work", synthetic: "compaction" },
]

test("sqlite round-trips every message shape and status", () => {
  const db = store()
  try {
    db.create(meta, history)
    const loaded = db.load("s1")
    expect(loaded.messages).toEqual(history)
    expect(loaded.meta).toMatchObject({
      id: "s1",
      cwd: "/tmp/project",
      model: "gpt-4o",
      createdAt: meta.createdAt,
    })
    expect(loaded.status).toBe("running")
    db.setStatus("s1", "limit")
    expect(db.load("s1").status).toBe("limit")
  } finally {
    db.close()
  }
})

test("assistant null content round-trips without becoming an empty string", () => {
  const db = store()
  try {
    const messages: Message[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: null },
    ]
    db.create(meta, messages)
    expect(db.load("s1").messages).toEqual(messages)
  } finally {
    db.close()
  }
})

test("sqlite round-trips fork metadata", () => {
  const db = store()
  try {
    db.create({ ...meta, parentId: "parent", forkBoundary: "msg_boundary" })
    expect(db.load("s1").meta).toMatchObject({
      parentId: "parent",
      forkBoundary: "msg_boundary",
    })
    expect(db.list()[0]).toMatchObject({ parentId: "parent", forkBoundary: "msg_boundary" })
  } finally {
    db.close()
  }
})

test("sqlite persists across reopen and derives a title", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-db-"))
  const path = join(dir, "nexus.db")
  const first = new SQLiteStore({ path })
  first.create(meta, history)
  first.close()

  const second = new SQLiteStore({ path })
  try {
    expect(second.load("s1").messages).toEqual(history)
    expect(second.listWithTitles()[0].title).toBe("fix the failing tests")
  } finally {
    second.close()
  }
})

test("sqlite lists sessions newest first", () => {
  const db = store()
  try {
    db.create({ ...meta, id: "old", createdAt: "2026-01-01T00:00:00.000Z" })
    db.create({ ...meta, id: "new", createdAt: "2026-02-01T00:00:00.000Z" })
    expect(db.list().map((m) => m.id)).toEqual(["new", "old"])
    expect(db.count()).toBe(2)
  } finally {
    db.close()
  }
})

test("message entries expose stable ids in append order", () => {
  const db = store()
  try {
    db.create(meta, history)
    const entries = db.messageEntries("s1")
    expect(entries).toHaveLength(history.length)
    expect(entries.every((entry) => entry.id.startsWith("msg_"))).toBe(true)
    expect(entries[0].message).toEqual(history[0])
    // Ids are stable across loads.
    expect(db.messageEntries("s1").map((entry) => entry.id)).toEqual(entries.map((entry) => entry.id))
  } finally {
    db.close()
  }
})

test("revertTo removes the boundary message and everything after it", () => {
  const db = store()
  try {
    db.create(meta, history)
    const entries = db.messageEntries("s1")
    const removed = db.revertTo("s1", entries[1].id)
    expect(removed).toBeGreaterThan(0)
    expect(db.load("s1").messages).toEqual(history.slice(0, 1))
    // The remaining messages still satisfy tool-call pairing.
    const remaining = db.load("s1").messages
    expect(() =>
      db.append("s1", {
        role: "tool",
        toolCallId: "c1",
        name: "read",
        result: { ok: true, output: "again" },
      }),
    ).toThrow(/orphan tool result/)
    expect(remaining).toHaveLength(1)
  } finally {
    db.close()
  }
})

test("fork copies history before a boundary and records lineage", () => {
  const db = store()
  try {
    db.create(meta, history)
    const entries = db.messageEntries("s1")
    const fork = db.fork("s1", { boundary: entries[3].id })
    expect(fork.parentId).toBe("s1")
    expect(fork.forkBoundary).toBe(entries[3].id)
    expect(fork.title).toContain("(fork)")
    expect(db.load(fork.id).messages).toEqual(history.slice(0, 3))
    expect(db.load(fork.id).status).toBe("done")
  } finally {
    db.close()
  }
})

test("export and import round-trip messages and counters", () => {
  const db = store()
  try {
    db.create(meta, history)
    db.setStatus("s1", "done")
    db.addUsage("s1", { inputTokens: 100, outputTokens: 20, cacheReadTokens: 10 }, 0.25)
    const doc = db.exportSession("s1")
    expect(doc.messages).toHaveLength(history.length)
    expect(doc.counters).toMatchObject({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 10 })

    db.delete("s1")
    const restored = db.importSession(doc)
    expect(restored.imported).toBe(true)
    expect(db.load("s1").messages).toEqual(history)
    expect(db.load("s1").status).toBe("done")
    expect(db.counters("s1")).toEqual(doc.counters)

    expect(db.importSession(doc).imported).toBe(false)
    expect(db.count()).toBe(1)
  } finally {
    db.close()
  }
})

test("legacy JSONL import is lossless and idempotent", () => {
  const legacyDir = mkdtempSync(join(tmpdir(), "nexus-legacy-"))
  const legacy = new JSONLStore(legacyDir)
  legacy.create(meta, history)
  legacy.setStatus("s1", "done")

  const db = store()
  try {
    expect(db.importLegacy(legacyDir)).toBe(1)
    expect(db.load("s1").messages).toEqual(history)
    expect(db.load("s1").status).toBe("done")
    expect(db.importLegacy(legacyDir)).toBe(0)
    expect(db.count()).toBe(1)
  } finally {
    db.close()
  }
})

test("partsForMessage projects typed parts", () => {
  expect(partsForMessage({ role: "user", content: "hi" })).toEqual([{ type: "text", data: { text: "hi" } }])
  expect(
    partsForMessage({ role: "assistant", content: null, toolCalls: [{ id: "c", name: "read", input: {} }] }),
  ).toEqual([{ type: "tool_call", data: { id: "c", name: "read", input: {} } }])
  expect(partsForMessage({ role: "user", content: "sum", synthetic: "compaction" })[0].type).toBe("compaction")
})

test("load reconstructs messages from typed parts, not the projection", () => {
  const db = store()
  try {
    db.create(meta, history)
    db.sqlite.exec("UPDATE session_parts SET message_json = NULL")
    expect(db.load("s1").messages).toEqual(history)
  } finally {
    db.close()
  }
})

test("two store instances append without seq collisions", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-db-"))
  const path = join(dir, "nexus.db")
  const a = new SQLiteStore({ path })
  const b = new SQLiteStore({ path })
  try {
    a.create(meta, [{ role: "user", content: "one" }])
    b.append("s1", { role: "assistant", content: "two" })
    a.append("s1", { role: "user", content: "three" })
    expect(a.load("s1").messages.map((m) => (m as { content?: string }).content)).toEqual([
      "one",
      "two",
      "three",
    ])
  } finally {
    a.close()
    b.close()
  }
})

test("tool results cannot be appended without a matching call", () => {
  const db = store()
  try {
    db.create(meta, [{ role: "user", content: "hi" }])
    expect(() =>
      db.append("s1", {
        role: "tool",
        toolCallId: "missing",
        name: "read",
        result: { ok: true, output: "x" },
      }),
    ).toThrow(/orphan tool result/)
  } finally {
    db.close()
  }
})
