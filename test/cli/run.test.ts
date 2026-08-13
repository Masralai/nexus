import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { JSONLStore } from "../../src/engine/state"
import type { Message, Tool } from "../../src/engine/types"
import { MockProvider } from "../../src/providers/mock"
import { consumeHeadless, parseFlags, selfTest } from "../../src/cli/run"
import type { Runtime } from "../../src/cli/launch"
import { loadConfig } from "../../src/cli/config"

const bash: Tool = {
  name: "bash",
  description: "",
  schema: {},
  readonly: false,
  async execute(input) {
    return { ok: true, output: String((input as { command?: string }).command ?? input) }
  },
}

function runtime(over: {
  provider: MockProvider
  registry?: Map<string, Tool>
  store: JSONLStore
}): Runtime {
  return {
    cfg: loadConfig(),
    provider: over.provider,
    compactProvider: new MockProvider(),
    registry: over.registry ?? new Map(),
    store: over.store,
  }
}

test("parseFlags strips --yes and --model", () => {
  expect(parseFlags(["--yes", "fix it", "--model", "gpt"])).toEqual({
    yes: true,
    model: "gpt",
    rest: ["fix it"],
  })
})

test("headless exits 0 on complete", async () => {
  const dir = join(tmpdir(), "nexus-cli-" + Math.random().toString(36).slice(2))
  const store = new JSONLStore(dir)
  const out: string[] = []
  const code = await consumeHeadless([{ role: "user", content: "hi" }], {
    runtime: runtime({ provider: new MockProvider([{ content: "hello" }]), store }),
    cwd: dir,
    model: "m",
    maxSteps: 5,
    sessionId: "h1",
    signal: new AbortController().signal,
    autoApprove: false,
    write: (s) => out.push(s),
  })
  expect(code).toBe(0)
  expect(out.join("")).toContain("hello")
  expect(store.load("h1").status).toBe("done")
})

test("headless exits 2 when aborted", async () => {
  const dir = join(tmpdir(), "nexus-cli-" + Math.random().toString(36).slice(2))
  const store = new JSONLStore(dir)
  const ac = new AbortController()
  ac.abort()
  const code = await consumeHeadless([{ role: "user", content: "hi" }], {
    runtime: runtime({ provider: new MockProvider([{ content: "nope" }]), store }),
    cwd: dir,
    model: "m",
    maxSteps: 5,
    sessionId: "h2",
    signal: ac.signal,
    autoApprove: false,
    write: () => {},
  })
  expect(code).toBe(2)
  expect(store.load("h2").status).toBe("aborted")
})

test("headless --yes auto-approves bash", async () => {
  const dir = join(tmpdir(), "nexus-cli-" + Math.random().toString(36).slice(2))
  const store = new JSONLStore(dir)
  const code = await consumeHeadless([{ role: "user", content: "go" }], {
    runtime: runtime({
      provider: new MockProvider([{ toolCalls: [{ id: "b1", name: "bash", input: { command: "ls" } }] }, { content: "done" }]),
      registry: new Map([["bash", bash]]),
      store,
    }),
    cwd: dir,
    model: "m",
    maxSteps: 5,
    sessionId: "h3",
    signal: new AbortController().signal,
    autoApprove: true,
    write: () => {},
  })
  expect(code).toBe(0)
  const tool = store.load("h3").messages.find((m) => m.role === "tool") as Extract<Message, { role: "tool" }>
  expect(tool.result.ok).toBe(true)
})

test("resume persists to same session file", async () => {
  const dir = join(tmpdir(), "nexus-cli-" + Math.random().toString(36).slice(2))
  const store = new JSONLStore(dir)
  const messages: Message[] = [{ role: "user", content: "go" }]
  await consumeHeadless(messages, {
    runtime: runtime({ provider: new MockProvider([{ content: "hi" }]), store }),
    cwd: dir,
    model: "m",
    maxSteps: 5,
    sessionId: "h4",
    signal: new AbortController().signal,
    autoApprove: false,
    write: () => {},
  })
  await consumeHeadless(messages, {
    runtime: runtime({ provider: new MockProvider([{ content: "again" }]), store }),
    cwd: dir,
    model: "m",
    maxSteps: 5,
    sessionId: "h4",
    signal: new AbortController().signal,
    autoApprove: false,
    resume: true,
    write: () => {},
  })
  const metas = readFileSync(store.path("h4"), "utf8")
    .split("\n")
    .filter((l) => l.includes('"type":"meta"'))
  expect(metas).toHaveLength(1)
})

test("selfTest returns 0 when provider yields content", async () => {
  expect(await selfTest(new MockProvider([{ content: "pong" }]))).toBe(0)
})

test("selfTest returns 1 when provider yields nothing", async () => {
  expect(await selfTest(new MockProvider([]))).toBe(1)
})
