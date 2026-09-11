import type { Tool, ToolContext } from "../engine/types"
import { isReadonlyTool } from "../engine/mode"
import { run } from "../engine/loop"

const MAX_OUTPUT = 8000
const DEFAULT_CHILD_MAX_STEPS = 15

function cap(text: string): string {
  return text.length <= MAX_OUTPUT ? text : `${text.slice(0, MAX_OUTPUT)}\n[...truncated ${text.length - MAX_OUTPUT} chars]`
}

function filterExploreRegistry(registry: Map<string, Tool>): Map<string, Tool> {
  const filtered = new Map<string, Tool>()
  for (const [name, tool] of registry) {
    if (tool.readonly || name === "task") {
      filtered.set(name, tool)
    }
  }
  // Ensure at least read/grep/glob equivalents if parent had them
  // If parent had no readonly tools (unlikely), still return what we have
  return filtered
}

export const task: Tool = {
  name: "task",
  description:
    "Spawn a parallel sub-agent for independent research. Input: { prompt, subagent_type?: 'explore'|'plan' }. For independent explorations, emit N parallel task calls in one Turn step — each runs concurrently. Explore agents are plan-mode (readonly-only) and do not mutate files.",
  schema: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      subagent_type: { type: "string", enum: ["explore", "plan"] },
      mode: { type: "string", enum: ["plan", "build"] },
    },
    required: ["prompt"],
  },
  readonly: true,
  async execute(input, ctx: ToolContext) {
    const { prompt, subagent_type, mode } = input as {
      prompt?: string
      subagent_type?: string
      mode?: string
    }

    if (!prompt || typeof prompt !== "string") {
      return { ok: false, output: "", error: "task requires string field 'prompt'" }
    }

    const depth = ctx.depth ?? 0
    const maxDepth = ctx.maxDepth ?? 3
    if (depth >= maxDepth) {
      return { ok: false, output: "", error: `max sub-agent depth (${maxDepth}) exceeded` }
    }

    const provider = ctx.provider
    const registry = ctx.registry
    if (!provider || !registry) {
      return { ok: false, output: "", error: "task not available: missing provider/registry context" }
    }

    if (ctx.signal?.aborted) {
      return { ok: false, output: "", error: "aborted" }
    }

    const childMode = (mode as "plan" | "build") ?? (subagent_type === "plan" ? "plan" : "plan")
    // For explore/plan, force plan mode. If explicit build requested, respect it but default to plan for safety.
    const effectiveMode = childMode === "build" ? "build" : "plan"

    let childRegistry: Map<string, Tool>
    if (effectiveMode === "plan") {
      childRegistry = filterExploreRegistry(registry)
      // Ensure task itself is present for nested spawning (if filtered out because parent task was not readonly? but task is readonly, so included)
      if (!childRegistry.has("task")) {
        const taskTool = registry.get("task")
        if (taskTool) childRegistry.set("task", taskTool)
      }
    } else {
      childRegistry = registry
    }

    // Build child prompt with explore guidance
    let childPrompt = prompt
    if ((subagent_type ?? "explore") === "explore") {
      childPrompt = `You are an explore sub-agent. Research thoroughly, do not mutate files, return a concise summary with file:line citations.\n\nTask: ${prompt}`
    }

    const childMessages = [{ role: "user" as const, content: childPrompt }]

    // Use parent signal directly for abort propagation; combine if AbortSignal.any available
    let signal = ctx.signal
    // If AbortSignal.any is available and we want child-specific abort, we could create a combined signal
    // For now, reuse parent signal (aborting parent aborts child)

    const outputs: string[] = []
    let finalResult = ""

    try {
      const childRun = run(childMessages, {
        provider,
        registry: childRegistry,
        cwd: ctx.cwd,
        model: ctx.model ?? "mock",
        maxSteps: DEFAULT_CHILD_MAX_STEPS,
        signal,
        // No store -> ephemeral, does not pollute parent Session
        store: undefined,
        sessionId: undefined,
        compactProvider: ctx.compactProvider,
        compactThreshold: ctx.compactThreshold,
        keepRecent: ctx.keepRecent,
        mode: effectiveMode,
        skills: [], // isolated, no parent skills
        askPermission: ctx.askPermission,
        autoApprove: ctx.autoApprove,
        rules: ctx.rules,
        depth: depth + 1,
        maxDepth,
      })

      for await (const ev of childRun) {
        if (ev.type === "toolResult") {
          // Collect tool results for summary
          outputs.push(`[${ev.name}] ${ev.result.output.slice(0, 500)}${ev.result.error ? ` [error] ${ev.result.error}` : ""}`)
        } else if (ev.type === "runComplete") {
          finalResult = ev.result
        } else if (ev.type === "aborted") {
          return { ok: false, output: cap(outputs.join("\n")), error: "aborted" }
        } else if (ev.type === "error") {
          return { ok: false, output: cap(outputs.join("\n")), error: ev.message }
        }
      }
    } catch (e) {
      return { ok: false, output: cap(outputs.join("\n")), error: e instanceof Error ? e.message : String(e) }
    }

    // Build summary: prefer finalResult, fallback to tool outputs
    let summary = ""
    if (finalResult) summary += finalResult
    if (outputs.length > 0) {
      if (summary) summary += "\n\n--- tool outputs ---\n"
      summary += outputs.join("\n")
    }
    if (!summary) summary = "(no output)"

    return { ok: true, output: cap(summary) }
  },
}
