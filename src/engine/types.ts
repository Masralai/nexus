import type { Provider, Usage } from "../providers/types"

export interface ToolCall {
  id: string
  name: string
  input: unknown
}

export interface ToolResult {
  ok: boolean
  output: string
  error?: string
}

export type Message =
  | { role: "user"; content: string; synthetic?: "compaction" }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; result: ToolResult }

export interface ToolDefinition {
  name: string
  description: string
  schema: unknown
}

export interface ToolContext {
  cwd: string
  signal?: AbortSignal
  depth?: number
  maxDepth?: number
  provider?: Provider
  compactProvider?: Provider
  registry?: Map<string, Tool>
  model?: string
  store?: SessionStore
  sessionId?: string
  maxSteps?: number
  compactThreshold?: number
  keepRecent?: number
  mode?: import("./mode").AgentMode
  skills?: import("../skills").Skill[]
  askPermission?: (req: { id: string; name: string; input: unknown; reason: string }) => Promise<boolean>
  autoApprove?: boolean
  rules?: import("./permission").PermissionRules
}

export interface Tool {
  name: string
  description: string
  schema: unknown
  /** When true, a Readonly tool: parallel-safe, advertised in plan, auto-allowed by the Permission gate inside cwd. */
  readonly?: boolean
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>
}

export type SessionStatus = "running" | "done" | "aborted" | "error" | "limit"

export interface SessionMeta {
  id: string
  cwd: string
  model: string
  provider: string
  createdAt: string
  parentId?: string
  forkBoundary?: string
  title?: string
}

export interface LoadedSession {
  meta: SessionMeta
  status: SessionStatus
  messages: Message[]
}

export interface SessionStore {
  create(meta: SessionMeta, messages?: Message[]): void
  append(id: string, msg: Message): void
  setStatus(id: string, status: SessionStatus): void
  load(id: string): LoadedSession
  list(): SessionMeta[]
  listWithTitles(): Array<{ meta: SessionMeta; title: string }>
}

export type EngineEvent =
  | { type: "tokenDelta"; delta: string }
  | { type: "toolCallStarted"; id: string; name: string; input: unknown }
  | { type: "toolResult"; id: string; name: string; result: ToolResult }
  | { type: "permissionRequest"; id: string; name: string; input: unknown; reason: string }
  | { type: "contextUpdate"; used: number; limit: number; pct: number }
  | { type: "usage"; usage: Usage; cost?: number }
  | { type: "turnComplete"; step: number }
  | { type: "stepLimit"; steps: number }
  | { type: "runComplete"; steps: number; result: string; reason?: "complete" | "step_limit" }
  | { type: "error"; message: string }
  | { type: "aborted" }
