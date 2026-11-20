import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../engine/loop"
import { SQLiteStore } from "../engine/sqlite"
import { OpenAICompatible } from "../providers/openai-compatible"
import { defaultTools } from "../tools"
import { compareTranscripts, type Transcript } from "./harness"

const root = join(import.meta.dir, "../../fixtures")

interface Scenario {
  pin: { implementation: string; version: string; commit: string }
  prompt: string
  workspace: Record<string, string>
  streams: string[]
  reference: string
}

function readJson<T>(...path: string[]): T {
  return JSON.parse(readFileSync(join(root, ...path), "utf8")) as T
}

const scenario = readJson<Scenario>("parity", "read-file.json")
const reference = readJson<Transcript>("parity", scenario.reference)

/** Replay the recorded provider streams in request order: one response per step. */
function replayFetch(streams: string[]): typeof fetch {
  const queue = streams.map((path) => readFileSync(join(root, path), "utf8"))
  return (async () => {
    const body = queue.shift()
    if (body === undefined) throw new Error("replay: provider called more times than the fixture recorded")
    return new Response(body, { status: 200 })
  }) as unknown as typeof fetch
}

test("parity: Tier 1 replay matches the pinned reference transcript", async () => {
  expect(scenario.pin.commit).toMatch(/^[0-9a-f]{7,40}$/)
  const dir = mkdtempSync(join(tmpdir(), "nexus-parity-"))
  const store = new SQLiteStore({ path: join(dir, "state.db") })
  try {
    const cwd = join(dir, "repo")
    mkdirSync(cwd, { recursive: true })
    for (const [name, content] of Object.entries(scenario.workspace)) writeFileSync(join(cwd, name), content)

    const provider = new OpenAICompatible({
      apiKey: "replay",
      model: "parity",
      contextWindow: 128_000,
      fetchImpl: replayFetch(scenario.streams),
    })
    const events: Array<Record<string, unknown>> = []
    for await (const event of run([{ role: "user", content: scenario.prompt }], {
      provider,
      registry: new Map(defaultTools().map((tool) => [tool.name, tool])),
      cwd,
      model: "parity",
      maxSteps: 10,
      store,
      sessionId: "parity",
    })) {
      events.push(event as unknown as Record<string, unknown>)
    }

    const parts = store.sqlite
      .query("SELECT part_type FROM session_parts WHERE session_id = ? ORDER BY seq")
      .all("parity") as Array<{ part_type: string }>

    const actual: Transcript = { events, parts: parts.map((part) => ({ type: part.part_type })) }
    expect(actual.parts).toHaveLength(4)
    const report = compareTranscripts(actual, reference)
    expect(report.failures).toEqual([])
    expect(report.ok).toBe(true)
  } finally {
    store.sqlite.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
