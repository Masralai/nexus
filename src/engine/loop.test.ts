import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
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
    { toolCalls: [{ id: "c1", name: "echo", input: { text: "x" } }] },
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
    { toolCalls: [{ id: "c1", name: "echo", input: {} }] },
    { toolCalls: [{ id: "c2", name: "echo", input: {} }] },
    { toolCalls: [{ id: "c3", name: "echo", input: {} }] },
  ])
  const evts = await collect(
    run([{ role: "user", content: "go" }], cfg({ provider, registry: new Map([["echo", echo]]), maxSteps: 2 })),
  )
  expect(evts.filter((e) => e.type === "toolCallStarted")).toHaveLength(2)
  expect(evts.at(-1)).toEqual({ type: "runComplete", steps: 2, result: "" })
})

test("unknown tool yields error result and continues", async () => {
  const provider = new MockProvider([{ toolCalls: [{ id: "c1", name: "nope", input: {} }] }, { content: "done" }])
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
  const provider = new MockProvider([{ toolCalls: [{ id: "c1", name: "echo", input: {} }] }, { content: "ok" }])
  const messages: Message[] = [{ role: "user", content: "go" }]
  await collect(run(messages, cfg({ provider, registry: new Map([["echo", echo]]), store, sessionId: "s1" })))
  const loaded = store.load("s1")
  expect(loaded.status).toBe("done")
  expect(loaded.messages).toEqual(messages)
  expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"])
})

test("runs reads in parallel, mutators sequentially", async () => {
  let active = 0
  let maxActive = 0
  const tracker = (name: string): Tool => ({
    name,
    description: "",
    schema: {},
    async execute(input) {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 20))
      active--
      return { ok: true, output: String(input) }
    },
  })
  const provider = new MockProvider([
    {
      toolCalls: [
        { id: "r1", name: "read", input: "r1" },
        { id: "r2", name: "read", input: "r2" },
        { id: "b1", name: "bash", input: "b1" },
      ],
    },
    { content: "done" },
  ])
  const evts = await collect(
    run([{ role: "user", content: "go" }], cfg({
      provider,
      registry: new Map([["read", tracker("read")], ["bash", tracker("bash")]]),
      autoApprove: true,
    })),
  )
  expect(maxActive).toBe(2)
  const requests = evts.filter((e) => e.type === "permissionRequest")
  expect(requests.map((r) => (r as { name: string }).name)).toEqual(["bash"])
  expect(evts.filter((e) => e.type === "toolResult").map((r) => (r as { name: string }).name)).toEqual([
    "read",
    "read",
    "bash",
  ])
  expect(evts.at(-1)).toEqual({ type: "runComplete", steps: 1, result: "done" })
})

test("denies bash without approval", async () => {
  const provider = new MockProvider([{ toolCalls: [{ id: "b1", name: "bash", input: { command: "rm -rf /" } }] }, { content: "ok" }])
  const evts = await collect(run([{ role: "user", content: "go" }], cfg({ provider, registry: new Map([["bash", echo]]) })))
  expect(evts.find((e) => e.type === "toolResult")).toEqual({
    type: "toolResult",
    id: "b1",
    name: "bash",
    result: { ok: false, output: "", error: "permission denied" },
  })
})

test("grants bash via askPermission callback", async () => {
  const provider = new MockProvider([{ toolCalls: [{ id: "b1", name: "bash", input: { command: "ls" } }] }, { content: "ok" }])
  const evts = await collect(
    run([{ role: "user", content: "go" }], cfg({ provider, registry: new Map([["bash", echo]]), askPermission: async () => true })),
  )
  const tr = evts.find((e) => e.type === "toolResult") as { result: { ok: boolean } }
  expect(tr.result.ok).toBe(true)
})

test("injects structured working-memory at the front of each prompt", async () => {
  const provider = new MockProvider([{ content: "ok" }])
  await collect(run([{ role: "user", content: "fix the tests" }], cfg({ provider })))
  const wm = provider.lastPrompt[0]
  expect(wm).toEqual({
    role: "user",
    content: expect.stringContaining("task: fix the tests"),
  })
  expect((wm as { content: string }).content).toContain("[working-memory]")
})

test("resume appends without duplicating meta", async () => {
  const dir = join(tmpdir(), "nexus-loop-" + Math.random().toString(36).slice(2))
  const store = new JSONLStore(dir)
  const messages: Message[] = [{ role: "user", content: "go" }]
  await collect(run(messages, cfg({ provider: new MockProvider([{ content: "hi" }]), store, sessionId: "s1" })))
  await collect(
    run(messages, cfg({ provider: new MockProvider([{ content: "again" }]), store, sessionId: "s1", resume: true })),
  )
  const metas = readFileSync(store.path("s1"), "utf8")
    .split("\n")
    .filter((l) => l.includes('"type":"meta"'))
  expect(metas).toHaveLength(1)
  expect(store.load("s1").status).toBe("done")
  expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "assistant"])
})