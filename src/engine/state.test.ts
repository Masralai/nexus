import { expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { JSONLStore } from "./state"
import type { Message } from "./types"

const msgs: Message[] = [
  { role: "user", content: "hello" },
  { role: "assistant", content: "hi", toolCalls: [{ id: "c1", name: "t", input: { k: 1 } }] },
  { role: "tool", toolCallId: "c1", name: "t", result: { ok: true, output: "out" } },
]

test("roundtrips meta, status, and messages through JSONL", () => {
  const dir = join(tmpdir(), "nexus-state-" + Math.random().toString(36).slice(2))
  const s = new JSONLStore(dir)
  s.create({ id: "a", cwd: "/x", model: "m", provider: "p", createdAt: "now" }, [msgs[0]])
  s.append("a", msgs[1])
  s.append("a", msgs[2])
  s.setStatus("a", "done")
  expect(s.load("a")).toEqual({
    meta: { id: "a", cwd: "/x", model: "m", provider: "p", createdAt: "now" },
    status: "done",
    messages: msgs,
  })
})

test("interrupted session (no status line) loads as running", () => {
  const dir = join(tmpdir(), "nexus-state-" + Math.random().toString(36).slice(2))
  const s = new JSONLStore(dir)
  s.create({ id: "b", cwd: "/x", model: "m", provider: "p", createdAt: "now" }, [msgs[0]])
  const loaded = s.load("b")
  expect(loaded.status).toBe("running")
  expect(loaded.messages).toEqual([msgs[0]])
})