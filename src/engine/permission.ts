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