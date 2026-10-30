import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { NexusConfig } from "../../src/cli/config"
import { launchRuntime, runTurn, type Runtime, type RuntimeControls } from "../../src/cli/launch"
import { SQLiteStore } from "../../src/engine/sqlite"
import type { EngineEvent, PtyControl, Tool } from "../../src/engine/types"
import { MockProvider, type MockResponse } from "../../src/providers/mock"
import { PtyManager } from "../../src/runtime/pty"
import { bash, edit, task, write } from "../../src/tools"

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "nexus-runtime-"))
}

function config(over: Partial<NexusConfig> = {}): NexusConfig {
  return {
    provider: "mock",
    preset: "mock",
    model: "mock",
    maxSteps: 6,
    compactModel: "mock",
    compactThreshold: 0.8,
    autoTitle: false,
    workspaceBoundary: true,
    ...over,
  }
}

function runtimeFor(opts: {
  store: SQLiteStore
  script: MockResponse[]
  tools: Tool[]
  config?: Partial<NexusConfig>
  controls?: RuntimeControls
}): Runtime {
  return {
    cfg: config(opts.config),
    provider: new MockProvider(opts.script),
    compactProvider: new MockProvider(),
    registry: new Map(opts.tools.map((tool) => [tool.name, tool])),
    store: opts.store,
    ...(opts.controls ? { controls: opts.controls } : {}),
  }
}

function fakePty(calls: string[]): PtyControl {
  return {
    async run(_sessionId, command) {
      calls.push(command)
      return { output: `ran: ${command}`, exitCode: 0 }
    },
    close() {
      /* no-op */
    },
  }
}

async function collect(events: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const out: EngineEvent[] = []
  for await (const event of events) out.push(event)
  return out
}

function toolResults(events: EngineEvent[]): Extract<EngineEvent, { type: "toolResult" }>[] {
  return events.filter((event): event is Extract<EngineEvent, { type: "toolResult" }> => event.type === "toolResult")
}

test("PtyManager keeps cwd and exported environment across commands", async () => {
  const dir = workspace()
  mkdirSync(join(dir, "sub"))
  const pty = new PtyManager()
  try {
    const first = await pty.run("pty-session", "cd sub && export NEXUS_PTY_TEST=ok", {
      cwd: dir,
      timeoutMs: 8_000,
    })
    expect(first.exitCode).toBe(0)
    const second = await pty.run("pty-session", "pwd && echo $NEXUS_PTY_TEST", {
      cwd: dir,
      timeoutMs: 8_000,
    })
    expect(second.output).toContain("/sub")
    expect(second.output).toContain("ok")
  } finally {
    pty.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a Turn runs bash through the runtime PTY", async () => {
  const dir = workspace()
  const store = new SQLiteStore({ path: join(dir, "state", "nexus.db") })
  const calls: string[] = []
  const runtime = runtimeFor({
    store,
    script: [{ toolCalls: [{ id: "c1", name: "bash", input: { command: "echo hi" } }] }, { content: "done" }],
    tools: [bash],
    controls: { pty: fakePty(calls) } as unknown as RuntimeControls,
  })
  try {
    const events = await collect(
      runTurn({ messages: [{ role: "user", content: "run" }], runtime, cwd: dir, sessionId: "ses_pty", autoApprove: true }),
    )
    expect(calls).toEqual(["echo hi"])
    expect(toolResults(events)[0]?.result.output).toBe("ran: echo hi")
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("post-edit formatter notes are appended to the tool output", async () => {
  const dir = workspace()
  writeFileSync(join(dir, "a.ts"), "const x = 1\n")
  const store = new SQLiteStore({ path: join(dir, "state", "nexus.db") })
  const runtime = runtimeFor({
    store,
    script: [
      { toolCalls: [{ id: "c1", name: "edit", input: { path: "a.ts", oldString: "1", newString: "2" } }] },
      { content: "done" },
    ],
    tools: [edit],
    controls: {
      pty: fakePty([]),
      afterEdit: async () => ["[format] rewrote a.ts"],
    } as unknown as RuntimeControls,
  })
  try {
    const events = await collect(
      runTurn({ messages: [{ role: "user", content: "edit" }], runtime, cwd: dir, sessionId: "ses_edit", autoApprove: true }),
    )
    expect(toolResults(events)[0]?.result.output).toContain("[format] rewrote a.ts")
    expect(readFileSync(join(dir, "a.ts"), "utf8")).toBe("const x = 2\n")
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("mutating tools snapshot before writing when the store supports snapshots", async () => {
  const dir = workspace()
  const store = new SQLiteStore({ path: join(dir, "state", "nexus.db") })
  const runtime = runtimeFor({
    store,
    script: [
      { toolCalls: [{ id: "c1", name: "write", input: { path: "new.txt", content: "hello" } }] },
      { content: "done" },
    ],
    tools: [write],
  })
  try {
    await collect(
      runTurn({
        messages: [{ role: "user", content: "write" }],
        runtime,
        cwd: dir,
        sessionId: "ses_snap",
        autoApprove: true,
      }),
    )
    const snapshots = store.listSnapshots("ses_snap")
    expect(snapshots.length).toBe(1)
    expect(store.getSnapshot("ses_snap", snapshots[0].id)?.files[0]).toEqual({ path: "new.txt", content: null })
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("unattended Turns refuse writes outside the workspace boundary", async () => {
  const root = workspace()
  const dir = join(root, "work")
  mkdirSync(dir)
  const store = new SQLiteStore({ path: join(root, "state", "nexus.db") })
  const runtime = runtimeFor({
    store,
    script: [
      { toolCalls: [{ id: "c1", name: "write", input: { path: "../escape.txt", content: "nope" } }] },
      { content: "done" },
    ],
    tools: [write],
    config: { workspaceBoundary: true },
  })
  try {
    const events = await collect(
      runTurn({ messages: [{ role: "user", content: "write" }], runtime, cwd: dir, sessionId: "ses_escape", autoApprove: true }),
    )
    expect(toolResults(events)[0]?.result.error).toBe("permission denied")
    expect(existsSync(join(root, "escape.txt"))).toBe(false)
  } finally {
    store.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test("saved project permissions skip the prompt and are audited", async () => {
  const dir = workspace()
  const store = new SQLiteStore({ path: join(dir, "state", "nexus.db") })
  const project = store.ensureProject(dir)
  store.savePermission({ projectId: project.id, tool: "bash", pattern: "echo hi", action: "allow" })
  const runtime = runtimeFor({
    store,
    script: [{ toolCalls: [{ id: "c1", name: "bash", input: { command: "echo hi" } }] }, { content: "done" }],
    tools: [bash],
    controls: { pty: fakePty([]) } as unknown as RuntimeControls,
  })
  let asked = false
  try {
    const events = await collect(
      runTurn({
        messages: [{ role: "user", content: "run" }],
        runtime,
        cwd: dir,
        sessionId: "ses_saved",
        askPermission: async () => {
          asked = true
          return false
        },
      }),
    )
    expect(asked).toBe(false)
    expect(toolResults(events)[0]?.result.ok).toBe(true)
    const audit = store.listAudit("ses_saved")
    expect(audit[0]?.source).toBe("saved")
    expect(audit[0]?.action).toBe("allow")
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("reply \"always\" persists a project grant", async () => {
  const dir = workspace()
  const store = new SQLiteStore({ path: join(dir, "state", "nexus.db") })
  const project = store.ensureProject(dir)
  const runtime = runtimeFor({
    store,
    script: [
      { toolCalls: [{ id: "c1", name: "write", input: { path: "kept.txt", content: "ok" } }] },
      { content: "done" },
    ],
    tools: [write],
  })
  try {
    await collect(
      runTurn({
        messages: [{ role: "user", content: "write" }],
        runtime,
        cwd: dir,
        sessionId: "ses_always",
        askPermission: async () => "always",
      }),
    )
    const grants = store.listPermissions(project.id)
    expect(grants).toHaveLength(1)
    expect(grants[0]).toMatchObject({ tool: "write", pattern: "kept.txt", action: "allow" })
    expect(store.listAudit("ses_always")[0]?.source).toBe("remembered")
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("subagents persist as child Sessions linked to the parent", async () => {
  const dir = workspace()
  const store = new SQLiteStore({ path: join(dir, "state", "nexus.db") })
  const runtime = runtimeFor({
    store,
    script: [
      { toolCalls: [{ id: "t1", name: "task", input: { prompt: "find the answer" } }] },
      { content: "child findings" },
      { content: "parent done" },
    ],
    tools: [task, bash],
  })
  try {
    const events = await collect(
      runTurn({
        messages: [{ role: "user", content: "delegate" }],
        runtime,
        cwd: dir,
        sessionId: "ses_parent",
        autoApprove: true,
      }),
    )
    const result = toolResults(events)[0]
    expect(result?.result.ok).toBe(true)
    const child = store.list().find((meta) => meta.parentId === "ses_parent")
    expect(child).toBeDefined()
    expect(store.load(child!.id).messages.some((message) => message.role === "assistant")).toBe(true)
    expect(result?.result.output).toContain(`child session: ${child!.id}`)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("launchRuntime exposes long-lived controls", async () => {
  const dir = workspace()
  const store = new SQLiteStore({ path: join(dir, "state", "nexus.db") })
  const runtime = launchRuntime({ cwd: dir, store })
  try {
    expect(runtime.controls?.pty).toBeInstanceOf(PtyManager)
    expect(runtime.controls?.jobs).toBeDefined()
    expect(runtime.controls?.lsp).toBeDefined()
    expect(runtime.controls?.mcp).toBeDefined()
  } finally {
    await runtime.close?.()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
