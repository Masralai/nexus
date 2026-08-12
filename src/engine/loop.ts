import { randomUUID } from "node:crypto"
import type { Provider } from "../providers/types"
import type { JSONLStore } from "./state"
import type { EngineEvent, Message, Tool, ToolResult } from "./types"

export interface RunConfig {
  provider: Provider
  registry: Map<string, Tool>
  cwd: string
  model: string
  maxSteps: number
  store?: JSONLStore
  sessionId?: string
  signal?: AbortSignal
}

function approxTokens(m: Message): number {
  const text = m.role === "tool" ? m.result.output + (m.result.error ?? "") : (m.content ?? "")
  return Math.ceil(text.length / 4)
}

export async function* run(messages: Message[], cfg: RunConfig): AsyncIterable<EngineEvent> {
  const { provider, registry, cwd, model, maxSteps } = cfg
  const store = cfg.store
  const sessionId = cfg.sessionId ?? randomUUID()
  const limit = provider.contextWindow

  store?.create({ id: sessionId, cwd, model, provider: provider.id, createdAt: new Date().toISOString() }, messages)

  let steps = 0
  let result = ""

  try {
    while (true) {
      if (cfg.signal?.aborted) {
        store?.setStatus(sessionId, "aborted")
        yield { type: "aborted" }
        return
      }
      if (steps >= maxSteps) break

      const toolDefs = [...registry.values()].map((t) => ({ name: t.name, description: t.description, schema: t.schema }))
      const stream = provider.stream(messages, toolDefs, { signal: cfg.signal })

      let content: string | null = null
      let call: { id: string; name: string; input: unknown } | null = null
      for await (const ev of stream) {
        if (ev.type === "token") yield { type: "tokenDelta", delta: ev.text }
        else if (ev.type === "toolCall") {
          call = { id: ev.id, name: ev.name, input: ev.input }
          yield { type: "toolCallStarted", ...call }
        } else if (ev.type === "done") content = ev.content
      }

      messages.push({ role: "assistant", content, toolCalls: call ? [call] : undefined })
      store?.append(sessionId, messages[messages.length - 1])

      if (!call) {
        result = content ?? ""
        yield { type: "contextUpdate", used: budget(), limit, pct: pct() }
        yield { type: "turnComplete", step: steps }
        break
      }

      const tool = registry.get(call.name)
      let toolResult: ToolResult
      if (!tool) {
        toolResult = { ok: false, output: "", error: `unknown tool: ${call.name}` }
      } else {
        toolResult = await tool.execute(call.input, { cwd, requirePermission: async () => true })
      }
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, result: toolResult })
      store?.append(sessionId, messages[messages.length - 1])
      yield { type: "toolResult", id: call.id, name: call.name, result: toolResult }
      steps++
      yield { type: "contextUpdate", used: budget(), limit, pct: pct() }
      yield { type: "turnComplete", step: steps }
    }

    yield { type: "runComplete", steps, result }
    store?.setStatus(sessionId, "done")
  } catch (e) {
    yield { type: "error", message: e instanceof Error ? e.message : String(e) }
    store?.setStatus(sessionId, "error")
  }

  function budget(): number {
    return messages.reduce((n, m) => n + approxTokens(m), 0)
  }
  function pct(): number {
    return budget() / limit
  }
}