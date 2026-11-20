import { isAbsolute, relative, resolve, sep } from "node:path"

export type Decision = "allow" | "deny" | "ask"
export type PermissionAction = Decision
export type PermissionValue = PermissionAction | Record<string, PermissionAction>

export interface PermissionRules {
  allowTools?: string[]
  denyTools?: string[]
  askTools?: string[]
  denyPatterns?: RegExp[]
  // Granular permission style: tool name -> action or pattern->action map
  // covers read, edit, write, list, glob, grep, bash, external_directory, doom_loop, and wildcard tool patterns like mymcp_*
  read?: PermissionValue
  edit?: PermissionValue
  write?: PermissionValue
  list?: PermissionValue
  glob?: PermissionValue
  grep?: PermissionValue
  bash?: PermissionValue
  task?: PermissionValue
  external_directory?: PermissionValue
  doom_loop?: PermissionAction
  // generic tool patterns (e.g. "mymcp_*": "ask")
  [toolPattern: string]: PermissionValue | PermissionAction | string[] | RegExp[] | undefined
}

export interface DecideContext {
  readonly?: boolean
  outsideCwd?: boolean
  targetPath?: string
  cwd?: string
}

function wildcardToRegExp(pattern: string): RegExp {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
  return new RegExp(`^${esc}$`)
}

function matchesWildcard(pattern: string, target: string): boolean {
  // Expand ~ to home-ish match by treating ~ as literal prefix already handled in outside check
  return wildcardToRegExp(pattern).test(target)
}

function resolveGranular(value: PermissionValue | undefined, target: string): PermissionAction | undefined {
  if (value === undefined) return undefined
  if (typeof value === "string") return value as PermissionAction
  // object: pattern -> action, last matching wins
  let last: PermissionAction | undefined
  for (const [pat, act] of Object.entries(value)) {
    if (matchesWildcard(pat, target)) last = act as PermissionAction
  }
  return last
}

function resolveToolPermission(rules: PermissionRules, tool: string, target: string): PermissionAction | undefined {
  // edit covers write and apply_patch: fallback if no direct entry
  const hasEdit = (rules as Record<string, unknown>)["edit"] !== undefined
  const hasDirect = (rules as Record<string, unknown>)[tool] !== undefined
  if ((tool === "write" || tool === "apply_patch") && hasEdit && !hasDirect) {
    const editVal = (rules as Record<string, unknown>)["edit"] as PermissionValue | undefined
    const editResolved = resolveGranular(editVal, target)
    if (editResolved) return editResolved
    if (typeof editVal === "string") return editVal as PermissionAction
  }
  // Last-match-wins across all entries in insertion order (including "*" and exact keys)
  let last: PermissionAction | undefined
  for (const [key, val] of Object.entries(rules)) {
    if (key === "allowTools" || key === "denyTools" || key === "askTools" || key === "denyPatterns" || key === "external_directory" || key === "doom_loop") continue
    const isMatch = key === tool || ( (key.includes("*") || key.includes("?")) && matchesWildcard(key, tool)) || key === "*"
    if (!isMatch) continue
    const resolved = resolveGranular(val as PermissionValue, target)
    if (resolved) last = resolved
    else if (typeof val === "string") last = val as PermissionAction
  }
  return last
}

export function decide(rules: PermissionRules, tool: string, reason: string, ctx: DecideContext = {}): Decision {
  // legacy hard rules
  if (rules.denyTools?.includes(tool)) return "deny"
  if (rules.denyPatterns?.some((re) => re.test(reason))) return "deny"
  if (rules.allowTools?.includes(tool)) return "allow"
  if (rules.askTools?.includes(tool)) return "ask"

  // granular per-tool patterns
  const target = ctx.targetPath ?? reason
  const granular = resolveToolPermission(rules, tool, target)
  if (granular) return granular

  // external_directory granular check (when outsideCwd)
  if (ctx.outsideCwd) {
    const ext = rules.external_directory as PermissionValue | undefined
    const extResolved = resolveGranular(ext, target)
    if (extResolved) return extResolved
    // default for external is ask (parity default)
    // fall through to ask below if not explicitly allowed
  }

  // default: read *.env denied (but *.env.example allowed)
  if (tool === "read" && target) {
    const base = target.split("/").pop() ?? target
    if (base === ".env.example" || base.endsWith(".env.example")) {
      // explicitly allowed
    } else if (base === ".env" || base.startsWith(".env.") || base.includes(".env.")) {
      // match "*.env" and "*.env.*"
      if (/\.env(\.|$)/.test(base)) return "deny"
    } else if (target.includes(".env")) {
      // also catch paths like "a/.env" or "config/.env.local"
      if (/(^|\/)\.env(\.|$|\/)/.test(target)) return "deny"
    }
  }

  if (ctx.outsideCwd) return "ask"
  if (tool === "bash" && isReadOnlyBash(reason, ctx.cwd)) return "allow"
  if (ctx.readonly) return "allow"
  return "ask"
}

export interface PermissionRequest {
  id: string
  name: string
  input: unknown
  reason: string
}

/** A client may grant once or remember the grant for the project. */
export type PermissionReply = boolean | "always"

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
  const decideReason =
    opts.name === "bash" &&
    opts.input &&
    typeof opts.input === "object" &&
    "command" in (opts.input as Record<string, unknown>)
      ? String((opts.input as Record<string, unknown>).command)
      : reason
  const target = pathForCall(opts.name, opts.input)
  const outsideCwd = Boolean(opts.cwd && target && isOutsideCwd(opts.cwd, target))
  const d = decide(opts.rules, opts.name, decideReason, {
    readonly: opts.readonly,
    outsideCwd,
    targetPath: target ?? decideReason,
    cwd: opts.cwd,
  })
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
  if ((name === "worktree_create" || name === "worktree_remove") && typeof obj.directory === "string") return obj.directory
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

function tokenizeShellWords(s: string): string[] | null {
  const out: string[] = []
  let cur = ""
  let q: "'" | '"' | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (q) {
      if (c === q) q = null
      else if (c === "\\" && q === '"' && i + 1 < s.length) cur += s[++i]!
      else cur += c
      continue
    }
    if (c === "'" || c === '"') {
      q = c
      continue
    }
    if (c === "\\") {
      if (i + 1 < s.length) cur += s[++i]!
      continue
    }
    if (/\s/.test(c)) {
      if (cur) {
        out.push(cur)
        cur = ""
      }
      continue
    }
    if (";|&<>`".includes(c) || c === "\n" || c === "\r") return null
    if (c === "$" && s[i + 1] === "(") return null
    cur += c
  }
  if (q) return null
  if (cur) out.push(cur)
  return out
}

const READ_ONLY_BASH = new Set([
  "pwd",
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "stat",
  "file",
  "which",
  "type",
  "whoami",
  "id",
  "uname",
  "date",
  "env",
  "printenv",
  "echo",
  "rg",
  "grep",
  "find",
  "git",
  "tree",
  "du",
  "df",
  "realpath",
  "readlink",
  "basename",
  "dirname",
])
const PATHLESS_READ_ONLY_BASH = new Set(["pwd", "whoami", "id", "uname", "date", "env", "printenv", "echo"])
const READ_ONLY_GIT_SUB = new Set(["status", "diff", "log", "show", "rev-parse", "blame", "shortlog", "describe", "ls-files", "ls-tree"])
const GIT_PATH_FLAGS = new Set(["-C", "--git-dir", "--work-tree", "--namespace", "--exec-path"])

function pathArgEscapes(arg: string, cwd?: string): boolean {
  if (!cwd) return arg.startsWith("/") || arg.startsWith("~") || arg.includes("..") || /^[A-Za-z]:[\\/]/.test(arg)
  return isOutsideCwd(cwd, arg)
}

function bashArgsSafe(args: string[], cwd?: string, pathFrom = 0, skipFirstPositional = false): boolean {
  let skipped = false
  for (let i = pathFrom; i < args.length; i++) {
    const a = args[i]!
    if (GIT_PATH_FLAGS.has(a)) {
      i++
      const v = args[i]
      if (v && pathArgEscapes(v, cwd)) return false
      continue
    }
    if (a.startsWith("-")) continue
    if (skipFirstPositional && !skipped) {
      skipped = true
      continue
    }
    if (pathArgEscapes(a, cwd)) return false
  }
  return true
}

export function isReadOnlyBash(command: string, cwd?: string): boolean {
  const argv = tokenizeShellWords(command.trim())
  if (!argv || argv.length === 0) return false
  const cmd = argv[0]!.split("/").pop() || argv[0]!
  if (!READ_ONLY_BASH.has(cmd)) return false
  if (PATHLESS_READ_ONLY_BASH.has(cmd)) return true

  if (cmd === "git") {
    // allow global path-taking flags before subcommand, conservatively
    let i = 1
    while (i < argv.length) {
      const a = argv[i]!
      if (GIT_PATH_FLAGS.has(a)) {
        const v = argv[i + 1]
        if (!v || pathArgEscapes(v, cwd)) return false
        i += 2
        continue
      }
      if (a.startsWith("-")) {
        i++
        continue
      }
      break
    }
    const sub = argv[i]
    if (!sub) return false
    if (sub === "branch") {
      // read-only listing/show-current forms only (no positional branch name)
      for (let j = i + 1; j < argv.length; j++) {
        const a = argv[j]!
        if (!a.startsWith("-")) return false
      }
      return true
    }
    if (!READ_ONLY_GIT_SUB.has(sub)) return false
    return bashArgsSafe(argv, cwd, i + 1)
  }

  if (cmd === "find") {
    const bad = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fls", "-fprintf", "-fprint0"])
    if (argv.some((a) => bad.has(a))) return false
    return bashArgsSafe(argv, cwd, 1)
  }

  if (cmd === "grep" || cmd === "rg") {
    // skip first positional (pattern); remaining positionals treated as paths
    return bashArgsSafe(argv, cwd, 1, true)
  }

  // ls/cat/head/tail/wc/stat/file/which/type/tree/du/df/realpath/readlink/basename/dirname: paths must stay in cwd
  return bashArgsSafe(argv, cwd, 1)
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
