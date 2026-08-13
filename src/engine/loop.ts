import { randomUUID } from "node:crypto"
import type { Provider } from "../providers/types"
import { assemblePrompt, budgetPct, budgetUsed, maybeCompact } from "./context"
import { advertiseTools, modePolicy, isReadonlyTool, type AgentMode } from "./mode"
import { gateToolCall, reasonForCall, type PermissionRules } from "./permission"
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
  /** Extra rules merged on top of agent-mode policy. */
  rules?: PermissionRules
  autoApprove?: boolean
  resume?: boolean
  compactProvider?: Provider
  compactThreshold?: number
  keepRecent?: number
  mode?: AgentMode
  askPermission?: (req: { id: string; name: string; input: unknown; reason: string }) => Promise<boolean>
}

function mergeRules(base: PermissionRules, extra?: PermissionRules): PermissionRules {
  if (!extra) return base
  return {
    allowTools: [...(base.allowTools ?? []), ...(extra.allowTools ?? [])],
    denyTools: [...(base.denyTools ?? []), ...(extra.denyTools ?? [])],
    askTools: [...(base.askTools ?? []), ...(extra.askTools ?? [])],
    denyPatterns: [...(base.denyPatterns ?? []), ...(extra.denyPatterns ?? [])],
  }
}

export async function* run(messages: Message[], cfg: RunConfig): AsyncIterable<EngineEvent> {
  const { provider, registry, cwd, model, maxSteps } = cfg
  const mode = cfg.mode ?? "build"
  const policy = modePolicy(mode)
  const rules = mergeRules(policy.rules, cfg.rules)
  const store = cfg.store
  const sessionId = cfg.sessionId ?? randomUUID()
  const limit = provider.contextWindow
  const threshold = cfg.compactThreshold ?? 0.8
  const keepRecent = cfg.keepRecent ?? 6

  if (store && !cfg.resume) {
    store.create({ id: sessionId, cwd, model, provider: provider.id, createdAt: new Date().toISOString() }, messages)
  } else if (store && cfg.resume) {
    const persisted = store.load(sessionId).messages
    for (const m of messages.slice(persisted.length)) store.append(sessionId, m)
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

      if (cfg.compactProvider) {
        try {
          const did = await maybeCompact(messages, {
            provider: cfg.compactProvider,
            threshold,
            keepRecent,
            limit,
          })
          if (did) yield { type: "contextUpdate", used: budgetUsed(messages), limit, pct: budgetPct(messages, limit) }
        } catch {
          // skip compaction; continue with truncation-only
        }
      }

      const toolDefs = advertiseTools(registry, mode)
      const prompt = assemblePrompt(messages, mode)
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
        yield { type: "contextUpdate", used: budgetUsed(messages), limit, pct: budgetPct(messages, limit) }
        yield { type: "turnComplete", step: steps }
        break
      }

      const grants = new Map<string, boolean>()
      for (const call of calls) {
        const askEvents: { id: string; name: string; input: unknown; reason: string }[] = []
        const granted = await gateToolCall({
          rules,
          id: call.id,
          name: call.name,
          input: call.input,
          reason: reasonForCall(call.name, call.input),
          askPermission: cfg.askPermission,
          autoApprove: cfg.autoApprove,
          onAsk: (req) => askEvents.push(req),
        })
        for (const req of askEvents) yield { type: "permissionRequest", ...req }
        grants.set(call.id, granted)
      }

      const exec = async (call: ToolCall): Promise<ToolResult> => {
        const tool = registry.get(call.name)
        if (!tool) return { ok: false, output: "", error: `unknown tool: ${call.name}` }
        if (!grants.get(call.id)) return { ok: false, output: "", error: "permission denied" }
        const ctx: ToolContext = { cwd }
        return tool.execute(call.input, ctx)
      }

      const results = new Map<string, ToolResult>()
      const readonlyCalls = calls.filter((c) => {
        const t = registry.get(c.name)
        return t ? isReadonlyTool(t) : false
      })
      const mutatorCalls = calls.filter((c) => !readonlyCalls.includes(c))
      await Promise.all(readonlyCalls.map(async (c) => results.set(c.id, await exec(c))))
      for (const c of mutatorCalls) results.set(c.id, await exec(c))

      for (const call of calls) {
        const toolResult = results.get(call.id)!
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, result: toolResult })
        store?.append(sessionId, messages[messages.length - 1])
        yield { type: "toolResult", id: call.id, name: call.name, result: toolResult }
      }

      steps++
      yield { type: "contextUpdate", used: budgetUsed(messages), limit, pct: budgetPct(messages, limit) }
      yield { type: "turnComplete", step: steps }
    }

    yield { type: "runComplete", steps, result }
    store?.setStatus(sessionId, "done")
  } catch (e) {
    yield { type: "error", message: e instanceof Error ? e.message : String(e) }
    store?.setStatus(sessionId, "error")
  }
}
