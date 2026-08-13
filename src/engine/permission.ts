export type Decision = "allow" | "deny" | "ask"

export interface PermissionRules {
  allowTools?: string[]
  denyTools?: string[]
  askTools?: string[]
  denyPatterns?: RegExp[]
}

export function decide(rules: PermissionRules, tool: string, reason: string): Decision {
  if (rules.denyTools?.includes(tool)) return "deny"
  if (rules.denyPatterns?.some((re) => re.test(reason))) return "deny"
  if (rules.allowTools?.includes(tool)) return "allow"
  if (rules.askTools?.includes(tool)) return "ask"
  if (tool === "bash") return "ask"
  return "allow"
}

export interface PermissionRequest {
  id: string
  name: string
  input: unknown
  reason: string
}

export interface GateOptions {
  rules: PermissionRules
  id: string
  name: string
  input: unknown
  /** Human-readable reason shown on ask (defaults to JSON of input). */
  reason?: string
  askPermission?: (req: PermissionRequest) => Promise<boolean>
  autoApprove?: boolean
  /** Notify caller that an ask is happening (e.g. yield engine event). */
  onAsk?: (req: PermissionRequest) => void
}

/** Single permission gate: may this tool call execute? */
export async function gateToolCall(opts: GateOptions): Promise<boolean> {
  const reason = opts.reason ?? JSON.stringify(opts.input)
  const d = decide(opts.rules, opts.name, reason)
  if (d === "allow") return true
  if (d === "deny") return false
  const req: PermissionRequest = { id: opts.id, name: opts.name, input: opts.input, reason }
  opts.onAsk?.(req)
  if (opts.askPermission) return opts.askPermission(req)
  return opts.autoApprove ?? false
}

/** Best-effort reason string from a tool call input. */
export function reasonForCall(name: string, input: unknown): string {
  if (name === "bash" && input && typeof input === "object" && "command" in input) {
    return String((input as { command: unknown }).command)
  }
  if ((name === "write" || name === "edit") && input && typeof input === "object" && "path" in input) {
    return `${name} ${(input as { path: unknown }).path}`
  }
  return JSON.stringify(input)
}
