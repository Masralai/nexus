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
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; result: ToolResult }

export interface ToolDefinition {
  name: string
  description: string
  schema: unknown
}

export interface ToolContext {
  cwd: string
}

export interface Tool {
  name: string
  description: string
  schema: unknown
  /** When true, safe to run in parallel and allowed in plan agent mode. */
  readonly?: boolean
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>
}

export type EngineEvent =
  | { type: "tokenDelta"; delta: string }
  | { type: "toolCallStarted"; id: string; name: string; input: unknown }
  | { type: "toolResult"; id: string; name: string; result: ToolResult }
  | { type: "permissionRequest"; id: string; name: string; input: unknown; reason: string }
  | { type: "contextUpdate"; used: number; limit: number; pct: number }
  | { type: "turnComplete"; step: number }
  | { type: "runComplete"; steps: number; result: string }
  | { type: "error"; message: string }
  | { type: "aborted" }