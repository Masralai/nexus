import type { Message, ToolDefinition } from "../engine/types"

export type ProviderEvent =
  | { type: "token"; text: string }
  | { type: "toolCall"; id: string; name: string; input: unknown }
  | { type: "done"; content: string | null }

export interface StreamOptions {
  signal?: AbortSignal
}

export interface Provider {
  readonly id: string
  readonly contextWindow: number
  readonly supportsCaching: boolean
  stream(messages: Message[], tools: ToolDefinition[], opts: StreamOptions): AsyncIterable<ProviderEvent>
}