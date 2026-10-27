import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SQLiteStore } from "./src/engine/sqlite"
import { MockProvider } from "./src/providers/mock"
import { question } from "./src/tools/question"
import { startServer } from "./src/server/server"
const dir = mkdtempSync(join(tmpdir(), "nexus-q-"))
const store = new SQLiteStore({ path: join(dir, "db.sqlite") })
const runtime = {
  cfg: { provider: "mock", preset: "mock", model: "mock", maxSteps: 5, compactModel: "mock", compactThreshold: 0.8, autoTitle: true, workspaceBoundary: true },
  provider: new MockProvider([
    { toolCalls: [{ id: "q1", name: "question", input: { questions: [{ header: "Pick", question: "Which?", options: [{ label: "A" }] }] } }] },
    { content: "done" },
  ]),
  compactProvider: new MockProvider(),
  registry: new Map([["question", { ...question, readonly: true }]]),
  store,
}
const server = await startServer({ store, token: "t", port: 0, hostname: "127.0.0.1", defaultCwd: dir, config: runtime.cfg as any, runtimeFactory: () => runtime as any })
const headers = { authorization: "Bearer t", "content-type": "application/json" }
const created = await fetch(`${server.url}/api/session`, { method: "POST", headers, body: "{}" })
const { data: session } = await created.json() as any
console.log("session", session.id, session.status)
const prompt = await fetch(`${server.url}/api/session/${session.id}/prompt`, { method: "POST", headers, body: JSON.stringify({ text: "go" }) })
console.log("prompt", prompt.status, await prompt.text())
for (let i = 0; i < 30; i++) {
  await Bun.sleep(100)
  const q = await fetch(`${server.url}/api/session/${session.id}/question`, { headers })
  const qb = await q.json() as any
  const s = await fetch(`${server.url}/api/session/${session.id}`, { headers })
  const sb = await s.json() as any
  console.log(i, "questions", JSON.stringify(qb), "status", sb.data?.status)
  if (qb.data?.length) {
    const r = await fetch(`${server.url}/api/session/${session.id}/question/${qb.data[0].id}/reply`, { method: "POST", headers, body: JSON.stringify({ answers: [{ header: "Pick", question: "Which?", answer: "A" }] }) })
    console.log("reply", r.status)
    break
  }
}
for (let i = 0; i < 30; i++) {
  await Bun.sleep(100)
  const s = await fetch(`${server.url}/api/session/${session.id}`, { headers })
  const sb = await s.json() as any
  console.log("status", sb.data?.status)
  if (sb.data?.status === "done") break
}
const m = await fetch(`${server.url}/api/session/${session.id}/message`, { headers })
console.log(JSON.stringify(await m.json(), null, 2).slice(0, 2000))
await server.stop(); store.close()
