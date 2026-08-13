import type { PermissionRules } from "./permission"
import type { Tool, ToolDefinition } from "./types"

export type AgentMode = "plan" | "build"

const PLAN_DENY = ["write", "edit", "bash"] as const

export interface ModePolicy {
  mode: AgentMode
  /** Permission rules applied for this mode (callers may merge extras). */
  rules: PermissionRules
  /** Extra system guidance appended into working memory. */
  guidance: string
}

/** Resolve advertised tools, permission rules, and prompt guidance for an agent mode. */
export function modePolicy(mode: AgentMode = "build"): ModePolicy {
  if (mode === "plan") {
    return {
      mode,
      rules: { denyTools: [...PLAN_DENY] },
      guidance: "\nMode: plan — explore and propose a plan; do not implement or mutate files.",
    }
  }
  return { mode: "build", rules: {}, guidance: "" }
}

export function isReadonlyTool(tool: Pick<Tool, "readonly" | "name">): boolean {
  if (tool.readonly !== undefined) return tool.readonly
  // fallback for ad-hoc test tools without metadata
  return false
}

/** Tools the model may see for this mode. */
export function advertiseTools(registry: Map<string, Tool>, mode: AgentMode): ToolDefinition[] {
  const all = [...registry.values()]
  const visible = mode === "plan" ? all.filter((t) => isReadonlyTool(t)) : all
  return visible.map((t) => ({ name: t.name, description: t.description, schema: t.schema }))
}
