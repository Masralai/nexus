import type { Message, ToolDefinition } from "../engine/types"
import type { Provider, ProviderEvent, StreamOptions } from "./types"

export interface MockResponse {
  content?: string
  toolCalls?: { id: string; name: string; input: unknown }[]
}

export class MockProvider implements Provider {
  readonly id = "mock"
  readonly supportsCaching = false
  readonly contextWindow: number
  lastPrompt: Message[] = []
  lastTools: ToolDefinition[] = []
  private responses: MockResponse[]

  constructor(script: MockResponse[] = [], contextWindow = 8000) {
    this.responses = [...script]
    this.contextWindow = contextWindow
  }

  setScript(script: MockResponse[]): void {
    this.responses = [...script]
  }

  async *stream(messages: Message[], tools: ToolDefinition[], _opts: StreamOptions): AsyncIterable<ProviderEvent> {
    this.lastPrompt = messages
    this.lastTools = tools
    const r = this.responses.shift()
    if (!r) {
      yield { type: "done", content: null }
      return
    }
    if (r.content) yield { type: "token", text: r.content }
    for (const c of r.toolCalls ?? []) yield { type: "toolCall", ...c }
    yield { type: "done", content: r.content ?? null }
  }
}