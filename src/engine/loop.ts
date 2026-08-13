import { randomUUID } from "node:crypto"
import type { Provider } from "../providers/types"
import { READ_TOOLS } from "../tools"
import { approxTokens, truncate, workingMemory } from "./context"
import { decide, type PermissionRules } from "./permission"
import type { JSONLStore } from "./state"
import type { EngineEvent, Message, Tool, ToolCall, ToolContext, ToolResult } from "./types"

export interface RunConfig {
  provider: Provider
  registry: Map<string, Tool>
  cwd: string
  model: string
  maxSteps: number
  store?: JSONLStore
  sessionId?: string
  signal?: AbortSignal
  rules?: PermissionRules
  autoApprove?: boolean
  resume?: boolean
  askPermission?: (req: { id: string; name: string; input: unknown; reason: string }) => Promise<boolean>
}

export async function* run(messages: Message[], cfg: RunConfig): AsyncIterable<EngineEvent> {
  const { provider, registry, cwd, model, maxSteps } = cfg
  const rules = cfg.rules ?? {}
  const store = cfg.store
  const sessionId = cfg.sessionId ?? randomUUID()
  const limit = provider.contextWindow

  // ponytail: resume skips create so meta isn't duplicated
  if (store && !cfg.resume) {
    store.create({ id: sessionId, cwd, model, provider: provider.id, createdAt: new Date().toISOString() }, messages)
  }

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
      const prompt = [
        { role: "user" as const, content: workingMemory(messages) },
        ...messages.map((m) => (m.role === "tool" ? { ...m, result: { ...m.result, output: truncate(m.result.output) } } : m)),
      ]
      const stream = provider.stream(prompt, toolDefs, { signal: cfg.signal })

      let content: string | null = null
      const calls: ToolCall[] = []
      for await (const ev of stream) {
        if (ev.type === "token") yield { type: "tokenDelta", delta: ev.text }
        else if (ev.type === "toolCall") {
          calls.push({ id: ev.id, name: ev.name, input: ev.input })
          yield { type: "toolCallStarted", id: ev.id, name: ev.name, input: ev.input }
        } else if (ev.type === "done") content = ev.content
      }

      messages.push({ role: "assistant", content, toolCalls: calls.length > 0 ? calls : undefined })
      store?.append(sessionId, messages[messages.length - 1])

      if (calls.length === 0) {
        result = content ?? ""
        yield { type: "contextUpdate", used: budget(), limit, pct: pct() }
        yield { type: "turnComplete", step: steps }
        break
      }

      const grants = new Map<string, boolean>()
      for (const call of calls) {
        const reason = JSON.stringify(call.input)
        const d = decide(rules, call.name, reason)
        let granted: boolean
        if (d === "allow") granted = true
        else if (d === "deny") granted = false
        else {
          yield { type: "permissionRequest", id: call.id, name: call.name, input: call.input, reason }
          granted = cfg.askPermission
            ? await cfg.askPermission({ id: call.id, name: call.name, input: call.input, reason })
            : (cfg.autoApprove ?? false)
        }
        grants.set(call.id, granted)
      }

      const exec = async (call: ToolCall): Promise<ToolResult> => {
        const tool = registry.get(call.name)
        if (!tool) return { ok: false, output: "", error: `unknown tool: ${call.name}` }
        if (!grants.get(call.id)) return { ok: false, output: "", error: "permission denied" }
        const ctx: ToolContext = {
          cwd,
          requirePermission: async (reason: string) => {
            const d = decide(rules, call.name, reason)
            if (d === "allow") return true
            if (d === "deny") return false
            return grants.get(call.id) ?? false
          },
        }
        return tool.execute(call.input, ctx)
      }

      const results = new Map<string, ToolResult>()
      await Promise.all(calls.filter((c) => READ_TOOLS.has(c.name)).map(async (c) => results.set(c.id, await exec(c))))
      for (const c of calls.filter((c) => !READ_TOOLS.has(c.name))) results.set(c.id, await exec(c))

      for (const call of calls) {
        const toolResult = results.get(call.id)!
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, result: toolResult })
        store?.append(sessionId, messages[messages.length - 1])
        yield { type: "toolResult", id: call.id, name: call.name, result: toolResult }
      }

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