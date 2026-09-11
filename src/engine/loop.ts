import { randomUUID } from "node:crypto"
import type { Provider } from "../providers/types"
import { assemblePrompt, budgetPct, budgetUsed, maybeCompact } from "./context"
import { advertiseTools, modePolicy, isReadonlyTool, type AgentMode } from "./mode"
import { gateToolCall, reasonForCall, type PermissionRules } from "./permission"
import { buildRepoMap } from "./repo-map"
import type { JSONLStore } from "./state"
import type { EngineEvent, Message, Tool, ToolCall, ToolContext, ToolResult } from "./types"
import type { Skill } from "../skills"

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
  /** Active agent skills injected into working memory. */
  skills?: Skill[]
  askPermission?: (req: { id: string; name: string; input: unknown; reason: string }) => Promise<boolean>
  depth?: number
  maxDepth?: number
}

function mergeRules(base: PermissionRules, extra?: PermissionRules): PermissionRules {
  if (!extra) return base
  const merged: PermissionRules = {
    allowTools: [...(base.allowTools ?? []), ...(extra.allowTools ?? [])],
    denyTools: [...(base.denyTools ?? []), ...(extra.denyTools ?? [])],
    askTools: [...(base.askTools ?? []), ...(extra.askTools ?? [])],
    denyPatterns: [...(base.denyPatterns ?? []), ...(extra.denyPatterns ?? [])],
  }
  // granular opencode fields: extra overwrites base if defined
  for (const [k, v] of Object.entries(extra)) {
    if (["allowTools", "denyTools", "askTools", "denyPatterns"].includes(k)) continue
    if (v !== undefined) (merged as Record<string, unknown>)[k] = v
  }
  for (const [k, v] of Object.entries(base)) {
    if (["allowTools", "denyTools", "askTools", "denyPatterns"].includes(k)) continue
    if ((merged as Record<string, unknown>)[k] === undefined && v !== undefined) (merged as Record<string, unknown>)[k] = v
  }
  return merged
}

function sameMessage(a: Message, b: Message): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Caller messages not already in the Session store, preserving order. */
function unpersisted(caller: readonly Message[], persisted: readonly Message[]): Message[] {
  const remaining = [...persisted]
  const incoming: Message[] = []
  for (const m of caller) {
    const idx = remaining.findIndex((p) => sameMessage(p, m))
    if (idx === -1) incoming.push(m)
    else remaining.splice(idx, 1)
  }
  return incoming
}

export async function* run(messages: readonly Message[], cfg: RunConfig): AsyncIterable<EngineEvent> {
  const { provider, registry, cwd, model, maxSteps } = cfg
  const mode = cfg.mode ?? "build"
  const policy = modePolicy(mode)
  const rules = mergeRules(policy.rules, cfg.rules)
  const store = cfg.store
  const sessionId = cfg.sessionId ?? randomUUID()
  const limit = provider.contextWindow
  const threshold = cfg.compactThreshold ?? 0.8
  const keepRecent = cfg.keepRecent ?? 6
  const depth = cfg.depth ?? 0
  const maxDepth = cfg.maxDepth ?? 3
  let working: Message[]

  if (store && !cfg.resume) {
    working = messages.slice()
    store.create({ id: sessionId, cwd, model, provider: provider.id, createdAt: new Date().toISOString() }, working)
  } else if (store && cfg.resume) {
    const persisted = store.load(sessionId).messages
    const incoming = unpersisted(messages, persisted)
    for (const m of incoming) store.append(sessionId, m)
    working = persisted.concat(incoming)
  } else {
    working = messages.slice()
  }

  let steps = 0
  let result = ""
  const doomCounts = new Map<string, number>()
  let repoMap: string | undefined
  try {
    repoMap = await buildRepoMap(cwd)
  } catch {
    repoMap = undefined
  }

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
          const compacted = await maybeCompact(working, {
            provider: cfg.compactProvider,
            threshold,
            keepRecent,
            limit,
          })
          if (compacted) {
            working = compacted
            // Persist hidden-agent compaction summary so resume retains continuity (opencode parity)
            try {
              store?.append(sessionId, compacted[0])
            } catch { /* ignore persistence errors */ }
            yield { type: "contextUpdate", used: budgetUsed(working), limit, pct: budgetPct(working, limit) }
          }
        } catch {
          // skip compaction; continue with truncation-only
        }
      }

      const toolDefs = advertiseTools(registry, mode)
      const prompt = assemblePrompt(working, mode, cfg.skills ?? [], repoMap)
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

      working.push({ role: "assistant", content, toolCalls: calls.length > 0 ? calls : undefined })
      store?.append(sessionId, working[working.length - 1])

      if (calls.length === 0) {
        result = content ?? ""
        yield { type: "contextUpdate", used: budgetUsed(working), limit, pct: budgetPct(working, limit) }
        yield { type: "turnComplete", step: steps }
        break
      }

      const grants = new Map<string, boolean>()
      for (const call of calls) {
        const tool = registry.get(call.name)
        if (!tool) {
          grants.set(call.id, true)
          continue
        }
        // doom_loop detection: 3+ identical tool calls
        const doomKey = `${call.name}:${JSON.stringify(call.input)}`
        const prev = doomCounts.get(doomKey) ?? 0
        doomCounts.set(doomKey, prev + 1)
        if (prev + 1 >= 3 && rules.doom_loop !== "allow") {
          const doomDecision = rules.doom_loop ?? "ask"
          if (doomDecision === "deny") {
            grants.set(call.id, false)
            yield { type: "permissionRequest", id: call.id, name: call.name, input: call.input, reason: `doom_loop: repeated ${call.name} 3x` }
            continue
          }
          if (doomDecision === "ask") {
            const req = { id: call.id, name: call.name, input: call.input, reason: `doom_loop: repeated ${call.name} 3x` }
            yield { type: "permissionRequest", ...req }
            let granted = false
            if (cfg.askPermission) granted = await cfg.askPermission(req)
            else granted = cfg.autoApprove ?? false
            grants.set(call.id, granted)
            continue
          }
        }
        const askEvents: { id: string; name: string; input: unknown; reason: string }[] = []
        const granted = await gateToolCall({
          rules,
          id: call.id,
          name: call.name,
          input: call.input,
          reason: reasonForCall(call.name, call.input),
          readonly: isReadonlyTool(tool),
          cwd,
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
        const ctx: ToolContext = {
          cwd,
          signal: cfg.signal,
          depth,
          maxDepth,
          provider,
          compactProvider: cfg.compactProvider,
          registry,
          model,
          store,
          sessionId,
          maxSteps,
          compactThreshold: threshold,
          keepRecent,
          mode,
          skills: cfg.skills,
          askPermission: cfg.askPermission,
          autoApprove: cfg.autoApprove,
          rules,
        }
        return tool.execute(call.input, ctx)
      }

      const results = new Map<string, ToolResult>()
      // opencode optimistic parallel: all Tool calls in one step run concurrently
      await Promise.all(calls.map(async (c) => results.set(c.id, await exec(c))))

      for (const call of calls) {
        const toolResult = results.get(call.id)!
        working.push({ role: "tool", toolCallId: call.id, name: call.name, result: toolResult })
        store?.append(sessionId, working[working.length - 1])
        yield { type: "toolResult", id: call.id, name: call.name, result: toolResult }
      }

      steps++
      yield { type: "contextUpdate", used: budgetUsed(working), limit, pct: budgetPct(working, limit) }
      yield { type: "turnComplete", step: steps }
    }

    yield { type: "runComplete", steps, result }
    store?.setStatus(sessionId, "done")
  } catch (e) {
    yield { type: "error", message: e instanceof Error ? e.message : String(e) }
    store?.setStatus(sessionId, "error")
  }
}
