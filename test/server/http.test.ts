import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Runtime } from "../../src/cli/launch"
import type { NexusConfig } from "../../src/cli/config"
import type { Tool } from "../../src/engine/types"
import { SQLiteStore } from "../../src/engine/sqlite"
import { MockProvider, type MockResponse } from "../../src/providers/mock"
import { startServer, type ServerHandle } from "../../src/server/server"
import { question } from "../../src/tools/question"

function testConfig(over: Partial<NexusConfig> = {}): NexusConfig {
  return {
    provider: "mock",
    preset: "mock",
    model: "mock",
    maxSteps: 5,
    compactModel: "mock",
    compactThreshold: 0.8,
    autoTitle: true,
    workspaceBoundary: true,
    ...over,
  }
}

const echo: Tool = {
  name: "echo",
  description: "echo",
  schema: { type: "object" },
  readonly: true,
  async execute(input) {
    return { ok: true, output: JSON.stringify(input) }
  },
}

const danger: Tool = {
  name: "danger",
  description: "mutates something",
  schema: { type: "object" },
  readonly: false,
  async execute() {
    return { ok: true, output: "danger-ok" }
  },
}

const ask: Tool = { ...question, readonly: true }

interface TestServer {
  server: ServerHandle
  store: SQLiteStore
  dir: string
}

async function withServer(
  opts: { script?: MockResponse[]; tools?: Tool[]; config?: Partial<NexusConfig> },
  run: (ctx: TestServer) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "nexus-server-"))
  const store = new SQLiteStore({ path: join(dir, "state", "nexus.db") })
  const runtime: Runtime = {
    cfg: testConfig(opts.config),
    provider: new MockProvider(opts.script ?? []),
    compactProvider: new MockProvider(),
    registry: new Map((opts.tools ?? []).map((tool) => [tool.name, tool])),
    store,
  }
  const server = await startServer({
    store,
    token: "test-token",
    port: 0,
    hostname: "127.0.0.1",
    defaultCwd: dir,
    config: runtime.cfg,
    runtimeFactory: () => runtime,
  })
  try {
    await run({ server, store, dir })
  } finally {
    await server.stop()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

async function call(
  server: ServerHandle,
  path: string,
  init: RequestInit = {},
  token: string | null = "test-token",
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (token !== null) headers.set("authorization", `Bearer ${token}`)
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json")
  return fetch(`${server.url}${path}`, { ...init, headers })
}

async function post(server: ServerHandle, path: string, value: unknown): Promise<Response> {
  return call(server, path, { method: "POST", body: JSON.stringify(value) })
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeout = 3_000): Promise<T> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await fn()
    if (value !== undefined) return value
    await Bun.sleep(10)
  }
  throw new Error("timed out waiting for condition")
}

interface Frame {
  id?: number
  event?: string
  data?: Record<string, unknown>
}

function parseFrame(raw: string): Frame {
  const frame: Frame = {}
  for (const line of raw.split("\n")) {
    if (line.startsWith("id: ")) frame.id = Number(line.slice(4))
    else if (line.startsWith("event: ")) frame.event = line.slice(7)
    else if (line.startsWith("data: ")) frame.data = JSON.parse(line.slice(6)) as Record<string, unknown>
  }
  return frame
}

async function readSse(
  url: string,
  token: string,
  stop: (frame: Frame) => boolean,
  timeout = 3_000,
): Promise<Frame[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const frames: Frame[] = []
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
    expect(res.status).toBe(200)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf("\n\n")
      while (index >= 0) {
        const raw = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        if (raw.startsWith(":")) {
          index = buffer.indexOf("\n\n")
          continue
        }
        const frame = parseFrame(raw)
        frames.push(frame)
        if (stop(frame)) return frames
        index = buffer.indexOf("\n\n")
      }
    }
    return frames
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

async function sessionStatus(server: ServerHandle, id: string): Promise<string> {
  const res = await call(server, `/api/session/${id}`)
  const body = await json<{ data: { status: string } }>(res)
  return body.data.status
}

test("requires the server token", async () => {
  await withServer({}, async ({ server }) => {
    const missing = await fetch(`${server.url}/api/info`)
    expect(missing.status).toBe(401)
    const body = await json<{ error: { code: string } }>(missing)
    expect(body.error.code).toBe("unauthorized")

    const ok = await call(server, "/api/info")
    expect(ok.status).toBe(200)
    const info = await json<{ data: { version: string; pid: number } }>(ok)
    expect(info.data.version).toBe("0.1.0")
    expect(info.data.pid).toBe(process.pid)

    const query = await fetch(`${server.url}/api/info?token=test-token`)
    expect(query.status).toBe(200)
  })
})

test("session lifecycle and messages", async () => {
  await withServer({ script: [{ content: "hello" }] }, async ({ server }) => {
    const created = await post(server, "/api/session", { title: "first" })
    expect(created.status).toBe(201)
    const { data: session } = await json<{ data: { id: string; title: string } }>(created)
    expect(session.id.startsWith("ses_")).toBe(true)
    expect(session.title).toBe("first")

    const list = await call(server, "/api/session")
    expect(list.status).toBe(200)
    const listed = await json<{ data: Array<{ id: string }>; cursor: Record<string, unknown> }>(list)
    expect(listed.data.map((item) => item.id)).toContain(session.id)
    expect(listed.cursor).toEqual({})

    const patched = await call(server, `/api/session/${session.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "renamed" }),
    })
    expect(patched.status).toBe(204)
    const fetched = await call(server, `/api/session/${session.id}`)
    expect((await json<{ data: { title: string } }>(fetched)).data.title).toBe("renamed")

    const prompt = await post(server, `/api/session/${session.id}/prompt`, { text: "hi" })
    expect(prompt.status).toBe(200)
    await waitFor(async () => ((await sessionStatus(server, session.id)) === "done" ? true : undefined))

    const messages = await call(server, `/api/session/${session.id}/message`)
    const { data: stored } = await json<{ data: Array<{ role: string; content: string }> }>(messages)
    expect(stored.map((message) => message.role)).toEqual(["user", "assistant"])
    expect(stored[1].content).toBe("hello")

    const removed = await call(server, `/api/session/${session.id}`, { method: "DELETE" })
    expect(removed.status).toBe(204)
    expect((await call(server, `/api/session/${session.id}`)).status).toBe(404)
  })
})

test("streams replayable SSE events with global cursors", async () => {
  await withServer({ script: [{ content: "hello" }] }, async ({ server }) => {
    const created = await post(server, "/api/session", {})
    const { data: session } = await json<{ data: { id: string } }>(created)
    await post(server, `/api/session/${session.id}/prompt`, { text: "hi" })
    await waitFor(async () => ((await sessionStatus(server, session.id)) === "done" ? true : undefined))

    const frames = await readSse(
      `${server.url}/api/session/${session.id}/event?after=0`,
      "test-token",
      (frame) => frame.event === "runComplete",
    )
    const events = frames.map((frame) => frame.event)
    expect(events).toContain("messageAdded")
    expect(events).toContain("tokenDelta")
    expect(events).toContain("runComplete")
    const first = frames[0]
    expect(first.id).toBeGreaterThan(0)
    expect(first.data?.sessionID).toBe(session.id)

    const resumed = await readSse(
      `${server.url}/api/session/${session.id}/event?after=${first.id}`,
      "test-token",
      (frame) => frame.event === "runComplete",
    )
    expect(resumed.every((frame) => (frame.id ?? 0) > (first.id ?? 0))).toBe(true)

    const all = await readSse(
      `${server.url}/api/event?after=0`,
      "test-token",
      (frame) => frame.event === "runComplete",
    )
    expect(all.some((frame) => frame.data?.sessionID === session.id)).toBe(true)
  })
})

test("permission requests are answered over HTTP", async () => {
  await withServer(
    {
      script: [
        { toolCalls: [{ id: "c1", name: "danger", input: { value: 1 } }] },
        { content: "done" },
      ],
      tools: [danger],
    },
    async ({ server }) => {
      const created = await post(server, "/api/session", {})
      const { data: session } = await json<{ data: { id: string } }>(created)
      await post(server, `/api/session/${session.id}/prompt`, { text: "go" })

      const pending = await waitFor(async () => {
        const res = await call(server, `/api/session/${session.id}/permission`)
        const body = await json<{ data: Array<{ id: string; name: string }> }>(res)
        return body.data.length ? body.data : undefined
      })
      expect(pending[0].name).toBe("danger")

      const reply = await post(server, `/api/session/${session.id}/permission/${pending[0].id}/reply`, {
        decision: true,
      })
      expect(reply.status).toBe(204)
      await waitFor(async () => ((await sessionStatus(server, session.id)) === "done" ? true : undefined))

      const messages = await call(server, `/api/session/${session.id}/message`)
      const { data: stored } = await json<{ data: Array<{ role: string; result?: { output: string } }> }>(messages)
      const tool = stored.find((message) => message.role === "tool")
      expect(tool?.result?.output).toBe("danger-ok")
    },
  )
})

test("question requests are answered over HTTP", async () => {
  await withServer(
    {
      script: [
        {
          toolCalls: [
            {
              id: "q1",
              name: "question",
              input: {
                questions: [{ header: "Pick", question: "Which?", options: [{ label: "A" }] }],
              },
            },
          ],
        },
        { content: "done" },
      ],
      tools: [ask],
    },
    async ({ server }) => {
      const created = await post(server, "/api/session", {})
      const { data: session } = await json<{ data: { id: string } }>(created)
      await post(server, `/api/session/${session.id}/prompt`, { text: "go" })

      const pending = await waitFor(async () => {
        const res = await call(server, `/api/session/${session.id}/question`)
        const body = await json<{ data: Array<{ id: string }> }>(res)
        return body.data.length ? body.data : undefined
      })
      const reply = await post(server, `/api/session/${session.id}/question/${pending[0].id}/reply`, {
        answers: [{ header: "Pick", question: "Which?", answer: "A" }],
      })
      expect(reply.status).toBe(204)
      await waitFor(async () => ((await sessionStatus(server, session.id)) === "done" ? true : undefined))

      const messages = await call(server, `/api/session/${session.id}/message`)
      const { data: stored } = await json<{ data: Array<{ role: string; result?: { output: string } }> }>(messages)
      const tool = stored.find((message) => message.role === "tool")
      expect(tool?.result?.output).toContain("Answer: A")
    },
  )
})

test("exposes config, providers, models, agents, commands, and tools", async () => {
  await withServer(
    {
      config: {
        commands: { review: "Review the diff" },
        agents: { reviewer: { description: "Reviews code", mode: "plan" } },
      },
    },
    async ({ server }) => {
      const config = await json<{ data: { model: string } }>(await call(server, "/api/config"))
      expect(config.data.model).toBe("mock")

      const providers = await json<{ data: Array<{ id: string; configured: boolean }> }>(
        await call(server, "/api/provider"),
      )
      expect(providers.data.some((provider) => provider.id === "openai")).toBe(true)
      expect(JSON.stringify(providers.data)).not.toContain("sk-")

      const models = await json<{ data: Array<{ id: string }> }>(await call(server, "/api/model"))
      expect(models.data.some((model) => model.id === "gpt-4o")).toBe(true)

      const agents = await json<{ data: Array<{ id: string }> }>(await call(server, "/api/agent"))
      expect(agents.data.map((agent) => agent.id)).toEqual(expect.arrayContaining(["build", "plan", "reviewer"]))

      const commands = await json<{ data: Array<{ name: string }> }>(await call(server, "/api/command"))
      expect(commands.data[0].name).toBe("review")

      const planTools = await json<{ data: Array<{ name: string }> }>(
        await call(server, "/api/tool?mode=plan"),
      )
      expect(planTools.data.some((tool) => tool.name === "write")).toBe(false)
      const buildTools = await json<{ data: Array<{ name: string }> }>(
        await call(server, "/api/tool?mode=build"),
      )
      expect(buildTools.data.some((tool) => tool.name === "write")).toBe(true)
    },
  )
})

test("maps malformed requests and missing routes to typed errors", async () => {
  await withServer({}, async ({ server }) => {
    const malformed = await call(server, "/api/session", { method: "POST", body: "{" })
    expect(malformed.status).toBe(400)
    expect((await json<{ error: { code: string } }>(malformed)).error.code).toBe("bad_request")

    const missing = await call(server, "/api/session/ses_missing")
    expect(missing.status).toBe(404)

    const unknown = await call(server, "/api/nope")
    expect(unknown.status).toBe(404)

    const method = await call(server, "/api/info", { method: "POST" })
    expect(method.status).toBe(405)
    expect((await json<{ error: { code: string } }>(method)).error.code).toBe("method_not_allowed")
  })
})
