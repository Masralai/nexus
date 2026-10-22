import type { Message, ToolDefinition } from "../engine/types"
import type { Provider, ProviderEvent, StreamOptions, Usage } from "./types"

export interface MockResponse {
  content?: string
  toolCalls?: { id: string; name: string; input: unknown }[]
  usage?: Usage
}

export class MockProvider implements Provider {
  readonly id = "mock"
  readonly supportsCaching = false
  readonly contextWindow: number
  readonly maxOutputTokens = 8_192
  lastPrompt: Message[] = []
  lastTools: ToolDefinition[] = []
  lastSystem: string | undefined
  lastOptions: StreamOptions | undefined
  private responses: MockResponse[]

  constructor(script: MockResponse[] = [], contextWindow = 8000) {
    this.responses = [...script]
    this.contextWindow = contextWindow
  }

  setScript(script: MockResponse[]): void {
    this.responses = [...script]
  }

  async *stream(messages: Message[], tools: ToolDefinition[], opts: StreamOptions): AsyncIterable<ProviderEvent> {
    this.lastPrompt = messages
    this.lastTools = tools
    this.lastSystem = opts.system
    this.lastOptions = opts
    const r = this.responses.shift()
    if (!r) {
      yield { type: "done", content: null }
      return
    }
    if (r.content) yield { type: "token", text: r.content }
    for (const c of r.toolCalls ?? []) yield { type: "toolCall", ...c }
    yield { type: "done", content: r.content ?? null, ...(r.usage ? { usage: r.usage } : {}) }
  }
}
