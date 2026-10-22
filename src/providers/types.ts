import type { Message, ToolDefinition } from "../engine/types"

export interface Usage {
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export type ProviderEvent =
  | { type: "token"; text: string }
  | { type: "toolCall"; id: string; name: string; input: unknown }
  | { type: "done"; content: string | null; usage?: Usage }

export interface StreamOptions {
  signal?: AbortSignal
  /** System prompt. Sent as the provider's native system channel, never as a user message. */
  system?: string
  timeoutMs?: number
  /** Plugin-provided provider parameters (temperature, top_p, ...). Core fields win. */
  params?: Record<string, unknown>
}

export interface Provider {
  readonly id: string
  readonly contextWindow: number
  readonly maxOutputTokens: number
  readonly supportsCaching: boolean
  stream(messages: Message[], tools: ToolDefinition[], opts: StreamOptions): AsyncIterable<ProviderEvent>
}
