import { expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MockProvider } from "../providers/mock"
import { JSONLStore } from "./state"
import { run } from "./loop"
import type { EngineEvent, Message, Tool } from "./types"

const echo: Tool = {
  name: "echo",
  description: "echoes input back",
  schema: { type: "object", properties: { text: { type: "string" } } },
  async execute(input) {
    return { ok: true, output: JSON.stringify(input) }
  },
}

function cfg(over: Partial<Parameters<typeof run>[1]>): Parameters<typeof run>[1] {
  return { provider: new MockProvider(), registry: new Map(), cwd: "/tmp", model: "m", maxSteps: 50, ...over }
}

async function collect(iter: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const evts: EngineEvent[] = []
  for await (const e of iter) evts.push(e)
  return evts
}

test("stops when model returns no tool call", async () => {
  const provider = new MockProvider([{ content: "hello world" }])
  const evts = await collect(run([{ role: "user", content: "hi" }], cfg({ provider })))
  expect(evts.map((e) => e.type)).toEqual(["tokenDelta", "contextUpdate", "turnComplete", "runComplete"])
  expect(evts.at(-1)).toEqual({ type: "runComplete", steps: 0, result: "hello world" })
})

test("executes tool call then completes", async () => {
  const provider = new MockProvider([
    { toolCall: { id: "c1", name: "echo", input: { text: "x" } } },
    { content: "ok" },
  ])
  const evts = await collect(
    run([{ role: "user", content: "do it" }], cfg({ provider, registry: new Map([["echo", echo]]) })),
  )
  expect(evts.map((e) => e.type)).toEqual([
    "toolCallStarted",
    "toolResult",
    "contextUpdate",
    "turnComplete",
    "tokenDelta",
    "contextUpdate",
    "turnComplete",
    "runComplete",
  ])
  expect(evts.at(-1)).toEqual({ type: "runComplete", steps: 1, result: "ok" })
})

test("stops at maxSteps", async () => {
  const provider = new MockProvider([
    { toolCall: { id: "c1", name: "echo", input: {} } },
    { toolCall: { id: "c2", name: "echo", input: {} } },
    { toolCall: { id: "c3", name: "echo", input: {} } },
  ])
  const evts = await collect(
    run([{ role: "user", content: "go" }], cfg({ provider, registry: new Map([["echo", echo]]), maxSteps: 2 })),
  )
  expect(evts.filter((e) => e.type === "toolCallStarted")).toHaveLength(2)
  expect(evts.at(-1)).toEqual({ type: "runComplete", steps: 2, result: "" })
})

test("unknown tool yields error result and continues", async () => {
  const provider = new MockProvider([{ toolCall: { id: "c1", name: "nope", input: {} } }, { content: "done" }])
  const evts = await collect(run([{ role: "user", content: "go" }], cfg({ provider })))
  expect(evts.find((e) => e.type === "toolResult")).toEqual({
    type: "toolResult",
    id: "c1",
    name: "nope",
    result: { ok: false, output: "", error: "unknown tool: nope" },
  })
  expect(evts.at(-1)).toEqual({ type: "runComplete", steps: 1, result: "done" })
})

test("aborts on signal", async () => {
  const ac = new AbortController()
  ac.abort()
  const evts = await collect(run([{ role: "user", content: "go" }], cfg({ signal: ac.signal })))
  expect(evts).toEqual([{ type: "aborted" }])
})

test("persists every turn and replays losslessly", async () => {
  const dir = join(tmpdir(), "nexus-loop-" + Math.random().toString(36).slice(2))
  const store = new JSONLStore(dir)
  const provider = new MockProvider([{ toolCall: { id: "c1", name: "echo", input: {} } }, { content: "ok" }])
  const messages: Message[] = [{ role: "user", content: "go" }]
  await collect(
    run(messages, cfg({ provider, registry: new Map([["echo", echo]]), store, sessionId: "s1" })),
  )
  const loaded = store.load("s1")
  expect(loaded.status).toBe("done")
  expect(loaded.messages).toEqual(messages)
  expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"])
})