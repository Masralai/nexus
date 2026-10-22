import { randomUUID } from "node:crypto"
import type { Provider, Usage } from "../providers/types"
import { estimateCost, getModelInfo } from "../providers/catalog"
import { approxTextTokens, buildPrompt, budgetPct, budgetUsed, maybeCompact } from "./context"
import { advertiseTools, modePolicy, isReadonlyTool, type AgentMode } from "./mode"
import { gateToolCall, reasonForCall, type PermissionRules } from "./permission"
import { discoverInstructionsWithUrls, type InstructionFile } from "./instructions"
import { renderSystemPrompt, gitSummary } from "./prompt"
import type { EngineEvent, Message, SessionStore, Tool, ToolCall, ToolContext, ToolResult } from "./types"
import type { Skill } from "../skills"

export interface RunConfig {
  provider: Provider
  registry: Map<string, Tool>
  cwd: string
  model: string
  maxSteps: number
  store?: SessionStore
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
  /** Active agent skills injected into the system channel. */
  skills?: Skill[]
  /** Preloaded instruction files. When omitted, AGENTS.md discovery runs for cwd. */
  instructions?: InstructionFile[]
  /** Additional instruction files from config. */
  instructionPaths?: string[]
  /** Plugin-provided provider request parameters. */
  providerParams?: Record<string, unknown>
  /** Observe each permission decision without changing it. */
  onPermission?: (req: { name: string; input: unknown; granted: boolean }) => void
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
  // granular permission fields: extra overwrites base if defined
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

function isAbort(e: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  return e instanceof Error && (e.name === "AbortError" || /aborted/i.test(e.message))
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

  const instructions =
    cfg.instructions ??
    (await discoverInstructionsWithUrls({ cwd, extra: cfg.instructionPaths }))

  const system = renderSystemPrompt({
    mode,
    skills: cfg.skills,
    instructions,
    tools: [...registry.values()],
    environment: {
      cwd,
      platform: `${process.platform} ${process.arch}`,
      date: new Date().toISOString().slice(0, 10),
      model,
      provider: provider.id,
      // Sub-agents inherit the parent's workspace state; don't shell out per child.
      git: depth === 0 ? await gitSummary(cwd) : undefined,
    },
  })
  const systemTokens = approxTextTokens(system)

  let steps = 0
  let result = ""
  let limitHit = false
  const doomCounts = new Map<string, number>()

  try {
    while (true) {
      if (cfg.signal?.aborted) {
        store?.setStatus(sessionId, "aborted")
        yield { type: "aborted" }
        return
      }
      if (steps >= maxSteps) {
        limitHit = true
        break
      }

      if (cfg.compactProvider) {
        try {
          const compacted = await maybeCompact(working, {
            provider: cfg.compactProvider,
            threshold,
            keepRecent,
            limit,
            systemTokens,
            params: cfg.providerParams,
          })
          if (compacted) {
            working = compacted
            // Persist only the synthetic summary, never a re-appended user request.
            const summary = compacted[0]
            if (summary?.role === "user" && summary.synthetic === "compaction") {
              try {
                store?.append(sessionId, summary)
              } catch {
                /* persistence is best-effort here */
              }
            }
            yield { type: "contextUpdate", used: budgetUsed(working, systemTokens), limit, pct: budgetPct(working, limit, systemTokens) }
          }
        } catch {
          // skip compaction; continue with truncation-only
        }
      }

      const toolDefs = advertiseTools(registry, mode)
      const prompt = buildPrompt(working, system)
      const stream = provider.stream(prompt.messages, toolDefs, {
        signal: cfg.signal,
        system: prompt.system,
        params: cfg.providerParams,
      })

      let content: string | null = null
      const calls: ToolCall[] = []
      let stepUsage: Usage | undefined
      for await (const ev of stream) {
        if (ev.type === "token") yield { type: "tokenDelta", delta: ev.text }
        else if (ev.type === "toolCall") {
          calls.push({ id: ev.id, name: ev.name, input: ev.input })
          yield { type: "toolCallStarted", id: ev.id, name: ev.name, input: ev.input }
        } else if (ev.type === "done") {
          content = ev.content
          stepUsage = ev.usage
        }
      }

      if (stepUsage) {
        yield { type: "usage", usage: stepUsage, cost: estimateCost(getModelInfo(model), stepUsage) }
      }

      if (cfg.signal?.aborted) {
        store?.setStatus(sessionId, "aborted")
        yield { type: "aborted" }
        return
      }

      working.push({ role: "assistant", content, toolCalls: calls.length > 0 ? calls : undefined })
      store?.append(sessionId, working[working.length - 1])

      if (calls.length === 0) {
        result = content ?? ""
        yield { type: "contextUpdate", used: budgetUsed(working, systemTokens), limit, pct: budgetPct(working, limit, systemTokens) }
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
            cfg.onPermission?.({ name: call.name, input: call.input, granted: false })
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
            cfg.onPermission?.({ name: call.name, input: call.input, granted })
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
        cfg.onPermission?.({ name: call.name, input: call.input, granted })
      }

      const exec = async (call: ToolCall): Promise<ToolResult> => {
        const tool = registry.get(call.name)
        if (!tool) return { ok: false, output: "", error: `unknown tool: ${call.name}` }
        if (!grants.get(call.id)) return { ok: false, output: "", error: "permission denied" }
        if (cfg.signal?.aborted) return { ok: false, output: "", error: "aborted" }
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
      // optimistic parallel: all Tool calls in one step run concurrently
      await Promise.all(calls.map(async (c) => results.set(c.id, await exec(c))))

      for (const call of calls) {
        const toolResult = results.get(call.id)!
        working.push({ role: "tool", toolCallId: call.id, name: call.name, result: toolResult })
        store?.append(sessionId, working[working.length - 1])
        yield { type: "toolResult", id: call.id, name: call.name, result: toolResult }
      }

      steps++
      yield { type: "contextUpdate", used: budgetUsed(working, systemTokens), limit, pct: budgetPct(working, limit, systemTokens) }
      yield { type: "turnComplete", step: steps }
    }

    if (limitHit) {
      yield { type: "stepLimit", steps }
      yield { type: "runComplete", steps, result, reason: "step_limit" }
      store?.setStatus(sessionId, "limit")
      return
    }

    yield { type: "runComplete", steps, result }
    store?.setStatus(sessionId, "done")
  } catch (e) {
    if (isAbort(e, cfg.signal)) {
      store?.setStatus(sessionId, "aborted")
      yield { type: "aborted" }
      return
    }
    yield { type: "error", message: e instanceof Error ? e.message : String(e) }
    store?.setStatus(sessionId, "error")
  }
}
