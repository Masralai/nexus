import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Runtime } from "../../src/cli/launch"
import { SQLiteStore } from "../../src/engine/sqlite"
import { MockProvider } from "../../src/providers/mock"
import { startServer } from "../../src/server/server"
import { discoverService } from "../../src/server/state"
import { NexusClient, ROUTES } from "../../src/sdk/client"

test("SDK client uses the shared route table", () => {
  expect(ROUTES.prompt.path).toBe("/api/session/:sessionID/prompt")
})

test("SDK client drives a Turn over HTTP", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-sdk-"))
  const store = new SQLiteStore({ path: join(dir, "nexus.db") })
  const runtime: Runtime = {
    cfg: {
      provider: "mock",
      preset: "mock",
      model: "mock",
      maxSteps: 5,
      compactModel: "mock",
      compactThreshold: 0.8,
      autoTitle: true,
      workspaceBoundary: true,
    },
    provider: new MockProvider([{ content: "hello" }]),
    compactProvider: new MockProvider(),
    registry: new Map(),
    store,
  }
  const server = await startServer({
    store,
    token: "sdk-token",
    port: 0,
    hostname: "127.0.0.1",
    defaultCwd: dir,
    config: runtime.cfg,
    runtimeFactory: () => runtime,
    register: true,
    stateDir: dir,
  })
  try {
    const discovered = discoverService(dir)
    expect(discovered?.url).toBe(server.url)
    expect(discovered?.password).toBe("sdk-token")
    const client = new NexusClient({ url: server.url, token: "sdk-token" })
    const info = await client.info()
    expect(info.version).toBe("0.1.0")
    const session = (await client.createSession({ title: "sdk" })) as { id: string; title: string }
    expect(session.title).toBe("sdk")
    await client.prompt(session.id, { text: "hi" })
    let done = false
    for await (const event of client.events({ sessionID: session.id })) {
      if (event.type === "runComplete") {
        done = true
        break
      }
    }
    expect(done).toBe(true)
    const messages = (await client.messages(session.id)) as Array<{ role: string; content?: string }>
    expect(messages.at(-1)?.content).toBe("hello")
  } finally {
    await server.stop()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
