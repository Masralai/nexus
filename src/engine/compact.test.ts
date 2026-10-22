import { expect, test } from "bun:test"
import { MockProvider } from "../providers/mock"
import { compactMessages, safeSplit, shouldCompact } from "./compact"
import type { Message } from "./types"

test("shouldCompact respects threshold", () => {
  expect(shouldCompact(0.79, 0.8)).toBe(false)
  expect(shouldCompact(0.8, 0.8)).toBe(true)
  expect(shouldCompact(1, 0.8)).toBe(true)
})

test("compactMessages keeps tail and prepends prior context", async () => {
  const messages: Message[] = Array.from({ length: 8 }, (_, i) => ({
    role: "user" as const,
    content: `m${i}`,
  }))
  const cheap = new MockProvider([{ content: "SUM" }])
  const out = await compactMessages(messages, cheap, 3)
  expect(messages.map((m) => (m as { content: string }).content)).toEqual(["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7"])
  expect(out).not.toBe(messages)
  expect(out).toHaveLength(4)
  expect(out[0]).toEqual({ role: "user", content: "[prior context]\nSUM", synthetic: "compaction" })
  expect(out.slice(1).map((m) => (m as { content: string }).content)).toEqual(["m5", "m6", "m7"])
})

test("compactMessages is a no-op when under keepRecent", async () => {
  const messages: Message[] = [{ role: "user", content: "a" }, { role: "user", content: "b" }]
  const cheap = new MockProvider([{ content: "SUM" }])
  const out = await compactMessages(messages, cheap, 6)
  expect(out).toEqual(messages)
  expect(out).not.toBe(messages)
  expect(cheap.lastPrompt).toEqual([])
})

function paired(): Message[] {
  return [
    { role: "user", content: "u0" },
    { role: "assistant", content: null, toolCalls: [{ id: "c1", name: "read", input: {} }] },
    { role: "tool", toolCallId: "c1", name: "read", result: { ok: true, output: "r1" } },
    { role: "user", content: "u2" },
    { role: "assistant", content: null, toolCalls: [{ id: "c2", name: "read", input: {} }] },
    { role: "tool", toolCallId: "c2", name: "read", result: { ok: true, output: "r2" } },
    { role: "user", content: "u4" },
  ]
}

test("safeSplit never starts the tail with an orphan tool result", () => {
  const messages = paired()
  const split = safeSplit(messages, 2)
  expect(messages[split].role).not.toBe("tool")
  const kept = messages.slice(split)
  for (const m of kept) {
    if (m.role !== "tool") continue
    const owner = kept.some(
      (x) => x.role === "assistant" && x.toolCalls?.some((c) => c.id === m.toolCallId),
    )
    expect(owner).toBe(true)
  }
})

test("safeSplit keeps the active user request", () => {
  const messages: Message[] = [
    { role: "user", content: "old" },
    { role: "assistant", content: null, toolCalls: [{ id: "c1", name: "read", input: {} }] },
    { role: "tool", toolCallId: "c1", name: "read", result: { ok: true, output: "r1" } },
    { role: "user", content: "active" },
  ]
  const split = safeSplit(messages, 1)
  expect(split).toBe(3)
  expect((messages[split] as { content: string }).content).toBe("active")
})

test("compactMessages does not orphan a tool result at the split", async () => {
  const cheap = new MockProvider([{ content: "SUM" }])
  const out = await compactMessages(paired(), cheap, 2)
  const tail = out.slice(1)
  expect(tail[0].role).not.toBe("tool")
  for (const m of tail) {
    if (m.role !== "tool") continue
    expect(
      tail.some((x) => x.role === "assistant" && x.toolCalls?.some((c) => c.id === m.toolCallId)),
    ).toBe(true)
  }
})
