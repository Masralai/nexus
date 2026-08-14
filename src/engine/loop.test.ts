import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MockProvider } from "../providers/mock"
import { JSONLStore } from "./state"
import { run } from "./loop"
import { budgetUsed } from "./context"
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
  expect(loaded.messages).toEqual([
    { role: "user", content: "go" },
    { role: "assistant", content: null, toolCalls: [{ id: "c1", name: "echo", input: {} }] },
    { role: "tool", toolCallId: "c1", name: "echo", result: { ok: true, output: "{}" } },
    { role: "assistant", content: "ok" },
  ])
  expect(messages).toEqual([{ role: "user", content: "go" }])
})

test("runs reads in parallel, mutators sequentially", async () => {
  let active = 0
  let maxActive = 0
  const tracker = (name: string, readonly: boolean): Tool => ({
    name,
    description: "",
    schema: {},
    readonly,
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
        { id: "b1", name: "bash", input: { command: "b1" } },
      ],
    },
    { content: "done" },
  ])
  const evts = await collect(
    run([{ role: "user", content: "go" }], cfg({
      provider,
      registry: new Map([["read", tracker("read", true)], ["bash", tracker("bash", false)]]),
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

test("plan mode blocks write without asking", async () => {
  const provider = new MockProvider([
    { toolCalls: [{ id: "w1", name: "write", input: { path: "x", content: "y" } }] },
    { content: "ok" },
  ])
  const write: Tool = { ...echo, name: "write", readonly: false }
  const read: Tool = { ...echo, name: "read", readonly: true }
  const evts = await collect(
    run([{ role: "user", content: "write it" }], cfg({
      provider,
      registry: new Map([["write", write], ["read", read]]),
      mode: "plan",
    })),
  )
  expect(provider.lastTools.map((t) => t.name)).toEqual(["read"])
  expect(evts.some((e) => e.type === "permissionRequest")).toBe(false)
  expect(evts.find((e) => e.type === "toolResult")).toEqual({
    type: "toolResult",
    id: "w1",
    name: "write",
    result: { ok: false, output: "", error: "permission denied" },
  })
  expect(provider.lastPrompt[0]).toEqual({
    role: "user",
    content: expect.stringContaining("Mode: plan"),
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
  await collect(
    run([{ role: "user", content: "go" }], cfg({ provider: new MockProvider([{ content: "hi" }]), store, sessionId: "s1" })),
  )
  const continued: Message[] = [...store.load("s1").messages, { role: "user", content: "again" }]
  const snapshot = structuredClone(continued)
  await collect(
    run(continued, cfg({ provider: new MockProvider([{ content: "ok" }]), store, sessionId: "s1", resume: true })),
  )
  const metas = readFileSync(store.path("s1"), "utf8")
    .split("\n")
    .filter((l) => l.includes('"type":"meta"'))
  expect(metas).toHaveLength(1)
  expect(store.load("s1").status).toBe("done")
  expect(store.load("s1").messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"])
  expect(continued).toEqual(snapshot)
})
test("compacts when over threshold then continues", async () => {
  const messages: Message[] = Array.from({ length: 10 }, (_, i) => ({
    role: "user" as const,
    content: "x".repeat(200) + String(i),
  }))
  const provider = new MockProvider([{ content: "done" }], 100)
  const cheap = new MockProvider([{ content: "SUM" }])
  const evts = await collect(
    run(messages, cfg({ provider, compactProvider: cheap, compactThreshold: 0.1, keepRecent: 2 })),
  )
  expect(cheap.lastPrompt.length).toBeGreaterThan(0)
  expect(messages[0]).toEqual({ role: "user", content: "x".repeat(200) + "0" })
  expect(provider.lastPrompt[1]).toEqual({ role: "user", content: "[prior context]\nSUM" })
  const update = evts.find((e) => e.type === "contextUpdate")
  expect(update?.type).toBe("contextUpdate")
  if (update?.type === "contextUpdate") {
    expect(update.limit).toBe(100)
    expect(update.used).toBeLessThan(budgetUsed(messages))
  }
  expect(evts.at(-1)).toEqual({ type: "runComplete", steps: 0, result: "done" })
})

test("a compacting Turn leaves the caller's messages unchanged", async () => {
  const messages: Message[] = Array.from({ length: 10 }, (_, i) => ({
    role: "user" as const,
    content: "x".repeat(200) + String(i),
  }))
  const snapshot = structuredClone(messages)
  await collect(
    run(messages, cfg({
      provider: new MockProvider([{ content: "done" }], 100),
      compactProvider: new MockProvider([{ content: "SUM" }]),
      compactThreshold: 0.1,
      keepRecent: 2,
    })),
  )
  expect(messages).toEqual(snapshot)
})

test("resume after a compacting Turn appends from the Session store", async () => {
  const dir = join(tmpdir(), "nexus-loop-" + Math.random().toString(36).slice(2))
  const store = new JSONLStore(dir)
  const original: Message[] = Array.from({ length: 10 }, (_, i) => ({
    role: "user" as const,
    content: "x".repeat(200) + String(i),
  }))
  await collect(
    run(original, cfg({
      provider: new MockProvider([{ content: "done" }], 100),
      compactProvider: new MockProvider([{ content: "SUM" }]),
      compactThreshold: 0.1,
      keepRecent: 2,
      store,
      sessionId: "s1",
    })),
  )
  const continued: Message[] = [...original, { role: "user", content: "again" }]
  const snapshot = structuredClone(continued)
  const provider = new MockProvider([{ content: "ok" }], 100)
  const evts = await collect(
    run(continued, cfg({
      provider,
      compactProvider: new MockProvider([{ content: "SUM2" }]),
      compactThreshold: 0.1,
      keepRecent: 2,
      store,
      sessionId: "s1",
      resume: true,
    })),
  )
  const loaded = store.load("s1").messages
  expect(loaded.slice(0, 10)).toEqual(original)
  expect(loaded.map((m) => m.role)).toEqual([
    "user",
    "user",
    "user",
    "user",
    "user",
    "user",
    "user",
    "user",
    "user",
    "user",
    "assistant",
    "user",
    "assistant",
  ])
  expect(loaded.at(-2)).toEqual({ role: "user", content: "again" })
  expect(loaded.at(-1)).toEqual({ role: "assistant", content: "ok" })
  expect(continued).toEqual(snapshot)
  expect(provider.lastPrompt[1]).toEqual({ role: "user", content: "[prior context]\nSUM2" })
  const update = evts.find((e) => e.type === "contextUpdate")
  expect(update?.type).toBe("contextUpdate")
  if (update?.type === "contextUpdate") {
    expect(update.used).toBeLessThan(budgetUsed(loaded))
  }
  expect(readFileSync(store.path("s1"), "utf8")).not.toContain("[prior context]")
})

test("a compacting Turn never persists the summary; Session replay is lossless", async () => {
  const dir = join(tmpdir(), "nexus-loop-" + Math.random().toString(36).slice(2))
  const store = new JSONLStore(dir)
  const original: Message[] = Array.from({ length: 10 }, (_, i) => ({
    role: "user" as const,
    content: "x".repeat(200) + String(i),
  }))
  await collect(
    run(original, cfg({
      provider: new MockProvider([{ content: "done" }], 100),
      compactProvider: new MockProvider([{ content: "SUM" }]),
      compactThreshold: 0.1,
      keepRecent: 2,
      store,
      sessionId: "s1",
    })),
  )
  const jsonl = readFileSync(store.path("s1"), "utf8")
  expect(jsonl).not.toContain("[prior context]")
  expect(store.load("s1").messages).toEqual([...original, { role: "assistant", content: "done" }])
})

test("a second resume with the same caller list does not duplicate Session messages", async () => {
  const dir = join(tmpdir(), "nexus-loop-" + Math.random().toString(36).slice(2))
  const store = new JSONLStore(dir)
  const original: Message[] = [{ role: "user", content: "go" }]
  await collect(
    run(original, cfg({ provider: new MockProvider([{ content: "hi" }]), store, sessionId: "s1" })),
  )
  const continued: Message[] = [...original, { role: "user", content: "again" }]
  await collect(
    run(continued, cfg({ provider: new MockProvider([{ content: "ok" }]), store, sessionId: "s1", resume: true })),
  )
  await collect(
    run(continued, cfg({ provider: new MockProvider([{ content: "ok2" }]), store, sessionId: "s1", resume: true })),
  )
  const loaded = store.load("s1").messages
  expect(loaded.filter((m) => m.role === "user" && m.content === "again")).toHaveLength(1)
  expect(loaded.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "assistant"])
  expect(loaded.at(-1)).toEqual({ role: "assistant", content: "ok2" })
})

test("skips compaction when under threshold", async () => {
  const cheap = new MockProvider([{ content: "SUM" }])
  await collect(
    run([{ role: "user", content: "hi" }], cfg({
      provider: new MockProvider([{ content: "ok" }], 100_000),
      compactProvider: cheap,
      compactThreshold: 0.8,
    })),
  )
  expect(cheap.lastPrompt).toEqual([])
})
