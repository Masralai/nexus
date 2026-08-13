import { expect, test } from "bun:test"
import type { Message } from "../engine/types"
import { formatTranscript } from "./transcript"

test("formatTranscript includes user, assistant, and tools", () => {
  const messages: Message[] = [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: "hello",
      toolCalls: [{ id: "1", name: "bash", input: { cmd: "ls" } }],
    },
    { role: "tool", toolCallId: "1", name: "bash", result: { ok: true, output: "a\nb" } },
    { role: "assistant", content: "done" },
  ]
  expect(formatTranscript(messages)).toEqual([
    "you: hi",
    "hello",
    '▶ bash {"cmd":"ls"}',
    "  ok a",
    "done",
  ])
})

test("formatTranscript skips null assistant content without tools", () => {
  expect(formatTranscript([{ role: "assistant", content: null }])).toEqual([])
})
