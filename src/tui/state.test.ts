import { expect, test } from "bun:test"
import { initialTUIState, reduceEvent } from "./state"

test("streams assistant output inline and commits on turnComplete", () => {
  let s = initialTUIState("m")
  s = reduceEvent(s, { type: "tokenDelta", delta: "Hel" })
  s = reduceEvent(s, { type: "tokenDelta", delta: "lo" })
  expect(s.assistantOutput).toBe("Hello")
  s = reduceEvent(s, { type: "turnComplete", step: 0 })
  expect(s.lines).toEqual(["Hello"])
  expect(s.assistantOutput).toBe("")
})

test("shows tool activity and permission prompt", () => {
  let s = initialTUIState("m")
  s = reduceEvent(s, { type: "toolCallStarted", id: "c1", name: "bash", input: { command: "ls" } })
  expect(s.lines.at(-1)).toContain("▶ bash")
  s = reduceEvent(s, {
    type: "permissionRequest",
    id: "c1",
    name: "bash",
    input: { command: "ls" },
    reason: '{"command":"ls"}',
  })
  expect(s.permission?.name).toBe("bash")
  s = reduceEvent(s, { type: "toolResult", id: "c1", name: "bash", result: { ok: true, output: "src\n" } })
  expect(s.lines.at(-1)).toContain("ok src")
})

test("runComplete marks done and updates status", () => {
  let s = initialTUIState("m")
  s = reduceEvent(s, { type: "contextUpdate", used: 100, limit: 8000, pct: 0.0125 })
  s = reduceEvent(s, { type: "runComplete", steps: 3, result: "done" })
  expect(s.done).toBe(true)
  expect(s.status).toEqual({ used: 100, limit: 8000, pct: 0.0125, steps: 3, model: "m" })
})

test("error and abort terminal states", () => {
  let s = initialTUIState("m")
  s = reduceEvent(s, { type: "error", message: "boom" })
  expect(s).toMatchObject({ done: true, error: "boom" })
  s = initialTUIState("m")
  s = reduceEvent(s, { type: "aborted" })
  expect(s).toMatchObject({ done: true, aborted: true })
})