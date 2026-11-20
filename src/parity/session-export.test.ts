import { expect, test } from "bun:test"
import { mapSessionExport, type SessionExport } from "./session-export"

/** Shape captured from a reference session export (v2.1.2, sanitised upstream). */
function exported(): SessionExport {
  return {
    messages: [
      { type: "user", text: "Read a.txt and reply with its contents." },
      {
        type: "assistant",
        finish: "tool-calls",
        content: [
          { type: "reasoning", text: "need the file" },
          { type: "tool", name: "read", state: { status: "completed", content: [{ type: "text", text: "hello parity" }] } },
        ],
      },
      { type: "assistant", finish: "stop", content: [{ type: "text", text: "hello parity" }] },
    ],
  }
}

test("reference export normalises to the parity transcript shape", () => {
  const transcript = mapSessionExport(exported())
  expect(transcript.parts).toEqual([
    { type: "text" },
    { type: "tool_call" },
    { type: "tool_result" },
    { type: "text" },
  ])
  expect(transcript.events.filter((event) => event.type === "toolCallStarted").map((event) => event.name)).toEqual([
    "read",
  ])
  expect(transcript.events.at(-1)).toEqual({ type: "runComplete", steps: 1 })
  expect(transcript.status).toBe("runComplete")
  expect(transcript.exitCode).toBeUndefined()
})

test("reference tool errors become provider errors", () => {
  const transcript = mapSessionExport({
    messages: [
      {
        type: "assistant",
        finish: "tool-calls",
        content: [{ type: "tool", name: "read", state: { status: "error", content: [{ type: "text", text: "ENOENT" }] } }],
      },
    ],
  })
  expect(transcript.status).toBe("error")
  expect(transcript.events).toContainEqual({ type: "error", message: "read: ENOENT" })
})
