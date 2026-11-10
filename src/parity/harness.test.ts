import { expect, test } from "bun:test"
import { compareTranscripts, type Transcript } from "./harness"

function transcript(over: Partial<Transcript> = {}): Transcript {
  return {
    events: [
      { type: "toolCallStarted", name: "read" },
      { type: "toolResult", name: "read" },
      { type: "turnComplete", step: 1 },
      { type: "runComplete", steps: 1, result: "done" },
    ],
    parts: [{ type: "message" }, { type: "tool_call" }, { type: "tool_result" }],
    promptChars: 100,
    exitCode: 0,
    ...over,
  }
}

test("parity: equal transcripts pass", () => {
  const report = compareTranscripts(transcript(), transcript())
  expect(report).toMatchObject({ ok: true, failures: [], promptGrowthPct: 0 })
})

test("parity: structural divergence fails", () => {
  const report = compareTranscripts(
    transcript({ events: [{ type: "toolCallStarted", name: "grep" }, { type: "runComplete", steps: 2, result: "done" }], promptChars: 106 }),
    transcript(),
  )
  expect(report.ok).toBe(false)
  expect(report.failures.join("\n")).toContain("tool-call sequence")
  expect(report.failures.join("\n")).toContain("prompt size")
})

test("parity: provider errors fail even when the rest matches", () => {
  const actual = transcript({ events: [...transcript().events, { type: "error", message: "HTTP 429" }] })
  const report = compareTranscripts(actual, transcript())
  expect(report.ok).toBe(false)
  expect(report.failures[0]).toContain("provider errors")
})
