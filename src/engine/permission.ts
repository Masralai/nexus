import { isAbsolute, relative, resolve, sep } from "node:path"

export type Decision = "allow" | "deny" | "ask"

export interface PermissionRules {
  allowTools?: string[]
  denyTools?: string[]
  askTools?: string[]
  denyPatterns?: RegExp[]
}

export interface DecideContext {
  readonly?: boolean
  outsideCwd?: boolean
}

export function decide(rules: PermissionRules, tool: string, reason: string, ctx: DecideContext = {}): Decision {
  if (rules.denyTools?.includes(tool)) return "deny"
  if (rules.denyPatterns?.some((re) => re.test(reason))) return "deny"
  if (rules.allowTools?.includes(tool)) return "allow"
  if (rules.askTools?.includes(tool)) return "ask"
  if (ctx.outsideCwd) return "ask"
  if (ctx.readonly) return "allow"
  return "ask"
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
  readonly?: boolean
  cwd?: string
  askPermission?: (req: PermissionRequest) => Promise<boolean>
  autoApprove?: boolean
  /** Notify caller that an ask is happening (e.g. yield engine event). */
  onAsk?: (req: PermissionRequest) => void
}

/** Single permission gate: may this tool call execute? */
export async function gateToolCall(opts: GateOptions): Promise<boolean> {
  const reason = opts.reason ?? JSON.stringify(opts.input)
  const target = pathForCall(opts.name, opts.input)
  const outsideCwd = Boolean(opts.cwd && target && isOutsideCwd(opts.cwd, target))
  const d = decide(opts.rules, opts.name, reason, { readonly: opts.readonly, outsideCwd })
  if (d === "allow") return true
  if (d === "deny") return false
  const req: PermissionRequest = { id: opts.id, name: opts.name, input: opts.input, reason }
  opts.onAsk?.(req)
  if (opts.askPermission) return opts.askPermission(req)
  return opts.autoApprove ?? false
}

/** Path the Permission gate should check against the Session cwd, if any. */
export function pathForCall(name: string, input: unknown): string | undefined {
  if (name === "bash" || !input || typeof input !== "object") return undefined
  const obj = input as Record<string, unknown>
  if (typeof obj.path === "string") return obj.path
  if (name === "glob" && typeof obj.pattern === "string" && looksLikePath(obj.pattern)) return obj.pattern
  return undefined
}

export function isOutsideCwd(cwd: string, target: string): boolean {
  if (target.startsWith("~")) return true
  const root = resolve(cwd)
  const resolved = resolve(root, target)
  const rel = relative(root, resolved)
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)
}

function looksLikePath(s: string): boolean {
  return s.startsWith("/") || s.startsWith("~") || s.includes("..") || /^[A-Za-z]:[\\/]/.test(s)
}

/** Best-effort reason string from a tool call input. */
export function reasonForCall(name: string, input: unknown): string {
  if (name === "bash" && input && typeof input === "object" && "command" in input) {
    return String((input as { command: unknown }).command)
  }
  const path = pathForCall(name, input)
  if (path && (name === "write" || name === "edit" || name === "read" || name === "list" || name === "grep")) {
    return `${name} ${path}`
  }
  return JSON.stringify(input)
}
