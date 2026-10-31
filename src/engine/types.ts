import type { Provider, Usage } from "../providers/types"
import type { PermissionAction } from "./permission"

export interface ToolCall {
  id: string
  name: string
  input: unknown
}

export interface ImagePart {
  mimeType: string
  /** Base64 payload without a data: prefix. */
  data: string
  path?: string
}

export interface ToolResult {
  ok: boolean
  output: string
  error?: string
  images?: ImagePart[]
}

export type Message =
  | { role: "user"; content: string; synthetic?: "compaction"; images?: ImagePart[] }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; result: ToolResult }

export interface ToolDefinition {
  name: string
  description: string
  schema: unknown
}

export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionPrompt {
  header: string
  question: string
  options: QuestionOption[]
}

export interface QuestionAnswer {
  header: string
  question: string
  answer: string
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
  /** Tool call currently executing. Question pairing uses this, not the Session id. */
  toolCallId?: string
  maxSteps?: number
  compactThreshold?: number
  keepRecent?: number
  mode?: import("./mode").AgentMode
  skills?: import("../skills").Skill[]
  askPermission?: (
    req: { id: string; name: string; input: unknown; reason: string },
  ) => Promise<import("./permission").PermissionReply>
  askQuestion?: (questions: QuestionPrompt[], id: string) => Promise<QuestionAnswer[]>
  autoApprove?: boolean
  rules?: import("./permission").PermissionRules
  /** Stream partial shell/tool output. Best-effort; never awaited. */
  onOutput?: (chunk: string) => void
  /** Durable snapshots for mutating tools. */
  snapshots?: SnapshotStore
  /** Background job control. */
  jobs?: JobControl
  /** Long-lived PTY per session. */
  pty?: PtyControl
  /** Real language-server manager, when configured. */
  lsp?: LspControl
  /** MCP servers with tools/resources/prompts. */
  mcp?: McpControl
  /** Git worktree isolation. */
  worktree?: WorktreeControl
  /** Optional post-edit formatter/diagnostics hook. */
  afterEdit?: (paths: string[]) => Promise<string[]>
}

export interface StoredEvent {
  /** Global cursor across every Session; stable and resumable. */
  cursor: number
  sessionID: string
  /** Monotonic sequence within one Session. */
  seq: number
  event: EngineEvent | Record<string, unknown>
  createdAt: string
}

export interface SessionCounters {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
}

export interface InboxItem {
  id: string
  sessionId: string
  data: Record<string, unknown>
  createdAt: string
}

export interface DocumentRecord {
  id: string
  sessionId?: string
  kind: string
  data: unknown
  createdAt: string
}

export interface SavedPermissionRecord {
  id: string
  projectId?: string
  tool: string
  pattern?: string
  action: PermissionAction
  createdAt: string
}

export interface PermissionAuditRecord {
  id: string
  sessionId?: string
  tool: string
  input: unknown
  action: PermissionAction
  source: string
  createdAt: string
}

export interface SnapshotStore {
  saveSnapshot(sessionId: string, label: string, files: SnapshotFile[]): string
  getSnapshot(sessionId: string, id: string): { id: string; files: SnapshotFile[] } | undefined
  listSnapshots?(sessionId: string): Array<{ id: string; label: string; createdAt: string }>
}

export interface SnapshotFile {
  path: string
  content: string | null
}

export interface JobInfo {
  id: string
  sessionId: string
  command: string
  status: "running" | "done" | "error" | "killed"
  output: string
  exitCode?: number
  startedAt: string
  endedAt?: string
}

export interface JobControl {
  start(sessionId: string, command: string, opts?: { cwd?: string; env?: Record<string, string> }): Promise<JobInfo>
  get(id: string): JobInfo | undefined
  list(sessionId?: string): JobInfo[]
  kill(id: string): boolean
  /** Completed background work delivered to the Session, newest last. */
  inbox(sessionId: string): InboxItem[]
}

export interface PtyControl {
  run(sessionId: string, command: string, opts?: { cwd?: string; timeoutMs?: number; onOutput?: (chunk: string) => void }): Promise<{ output: string; exitCode: number }>
  close(sessionId?: string): void
}

export interface WorktreeEntry {
  directory: string
  branch?: string
  commit?: string
  /** True for the repository's main working tree. */
  root?: boolean
}

export interface WorktreeControl {
  create(input?: { name?: string; branch?: string; from?: string; directory?: string }): Promise<{ directory: string; branch: string }>
  list(): Promise<WorktreeEntry[]>
  remove(input: { directory: string; force?: boolean }): Promise<void>
}

export interface LspLocation {
  file: string
  line: number
  character: number
}

export interface LspControl {
  query(input: {
    operation: string
    file?: string
    line?: number
    character?: number
    query?: string
  }): Promise<{ ok: boolean; output: string; error?: string }>
  status(): Array<{ name: string; running: boolean; root?: string }>
}

export interface McpToolInfo {
  server: string
  name: string
  description: string
  inputSchema: unknown
}

export interface McpControl {
  tools(): McpToolInfo[]
  call(server: string, name: string, input: unknown): Promise<ToolResult>
  resources(server?: string): Promise<Array<{ server: string; uri: string; name?: string; mimeType?: string }>>
  readResource(server: string, uri: string): Promise<unknown>
  prompts(server?: string): Promise<Array<{ server: string; name: string; description?: string }>>
  getPrompt(server: string, name: string, args?: Record<string, string>): Promise<unknown>
  status(): Array<{ name: string; connected: boolean; error?: string; transport: string }>
  connect(name?: string): Promise<void>
  disconnect(name?: string): Promise<void>
  close(): Promise<void>
}

export interface Tool {
  name: string
  description: string
  schema: unknown
  /** When true, a Readonly tool: parallel-safe, advertised in plan, auto-allowed by the Permission gate inside cwd. */
  readonly?: boolean
  /** Tool output budget in characters, enforced before the next provider request. */
  outputLimit?: number
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
  | { type: "messageAdded"; message: Message; queued?: boolean }
  | { type: "tokenDelta"; delta: string }
  | { type: "toolCallStarted"; id: string; name: string; input: unknown }
  | { type: "toolResult"; id: string; name: string; result: ToolResult }
  | { type: "permissionRequest"; id: string; name: string; input: unknown; reason: string }
  | { type: "questionRequest"; id: string; questions: QuestionPrompt[] }
  | { type: "contextUpdate"; used: number; limit: number; pct: number }
  | { type: "usage"; usage: Usage; cost?: number }
  | { type: "turnComplete"; step: number }
  | { type: "stepLimit"; steps: number }
  | { type: "runComplete"; steps: number; result: string; reason?: "complete" | "step_limit" }
  | { type: "error"; message: string }
  | { type: "aborted" }
