import { expect, test } from "bun:test"
import { MockProvider } from "../providers/mock"
import { compactMessages, shouldCompact } from "./compact"
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
  expect(out[0]).toEqual({ role: "user", content: "[prior context]\nSUM" })
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
