import type { Message, ToolDefinition } from "../engine/types"
import type { Provider, ProviderEvent, StreamOptions } from "./types"
import { readSSE } from "./sse"

export interface OpenAICompatibleConfig {
  apiKey: string
  model: string
  contextWindow: number
  baseUrl?: string
  id?: string
  supportsCaching?: boolean
  fetchImpl?: typeof fetch
}

interface ChatMessage {
  role: "user" | "assistant" | "tool"
  content: string | null
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

export function toChatMessages(messages: Message[]): ChatMessage[] {
  return messages.map((m) => {
    if (m.role === "user") return { role: "user", content: m.content }
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: m.content,
        tool_calls: m.toolCalls?.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        })),
      }
    }
    return {
      role: "tool",
      tool_call_id: m.toolCallId,
      content: m.result.error ? `${m.result.output}\n[error] ${m.result.error}` : m.result.output,
    }
  })
}

export function parseArgs(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

export class OpenAICompatible implements Provider {
  readonly id: string
  readonly contextWindow: number
  readonly supportsCaching: boolean
  private fetchImpl: typeof fetch

  constructor(private cfg: OpenAICompatibleConfig) {
    this.id = cfg.id ?? "openai-compatible"
    this.contextWindow = cfg.contextWindow
    this.supportsCaching = cfg.supportsCaching ?? false
    this.fetchImpl = cfg.fetchImpl ?? fetch
  }

  async *stream(messages: Message[], tools: ToolDefinition[], opts: StreamOptions): AsyncIterable<ProviderEvent> {
    const base = (this.cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")
    const res = await this.fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        model: this.cfg.model,
        stream: true,
        messages: toChatMessages(messages),
        tools: tools.length ? tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } })) : undefined,
      }),
      signal: opts.signal,
    })
    if (!res.ok) throw new Error(`openai-compatible: HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`)

    const toolAcc = new Map<number, { id?: string; name?: string; args: string }>()
    let content = ""
    let toolFinish = false
    for await (const { data } of readSSE(res.body)) {
      if (data === "[DONE]") break
      let chunk: { choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[] }
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      const choice = chunk.choices?.[0]
      if (!choice) continue
      if (choice.finish_reason === "tool_calls") toolFinish = true
      const delta = choice.delta ?? {}
      if (delta.content) {
        content += delta.content
        yield { type: "token", text: delta.content }
      }
      for (const tc of delta.tool_calls ?? []) {
        const acc = toolAcc.get(tc.index) ?? { args: "" }
        if (tc.id) acc.id = tc.id
        if (tc.function?.name) acc.name = tc.function.name
        if (tc.function?.arguments) acc.args += tc.function.arguments
        toolAcc.set(tc.index, acc)
      }
    }

    const calls = [...toolAcc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, a]) => ({ id: a.id ?? `call_${a.name ?? "unknown"}`, name: a.name ?? "", input: parseArgs(a.args) }))
    if (toolFinish && calls.length > 0) {
      for (const c of calls) yield { type: "toolCall", ...c }
      yield { type: "done", content: content || null }
    } else {
      yield { type: "done", content: content || null }
    }
  }
}