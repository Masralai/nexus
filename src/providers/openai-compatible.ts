import type { Message, ToolDefinition } from "../engine/types"
import type { Provider, ProviderEvent, StreamOptions, Usage } from "./types"
import { fetchWithRetry, requestSignal } from "./retry"
import { readSSE } from "./sse"

const DEFAULT_TIMEOUT_MS = 120_000

export interface OpenAICompatibleConfig {
  apiKey: string
  model: string
  contextWindow: number
  baseUrl?: string
  id?: string
  supportsCaching?: boolean
  maxTokens?: number
  /** Wall-clock limit for one streaming request. Timeouts stay distinct from aborts. */
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

export function toChatMessages(messages: Message[]): ChatMessage[] {
  return messages
    .filter((m) => !(m.role === "assistant" && m.content === null && !(m.toolCalls?.length)))
    .map((m) => {
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

export class OpenAICompatible implements Provider {
  readonly id: string
  readonly contextWindow: number
  readonly maxOutputTokens: number
  readonly supportsCaching: boolean
  private fetchImpl: typeof fetch

  constructor(private cfg: OpenAICompatibleConfig) {
    this.id = cfg.id ?? "openai-compatible"
    this.contextWindow = cfg.contextWindow
    this.maxOutputTokens = cfg.maxTokens ?? 8_192
    this.supportsCaching = cfg.supportsCaching ?? false
    this.fetchImpl = cfg.fetchImpl ?? fetch
  }

  async *stream(messages: Message[], tools: ToolDefinition[], opts: StreamOptions): AsyncIterable<ProviderEvent> {
    const base = (this.cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")
    const chat = toChatMessages(messages)
    if (opts.system) chat.unshift({ role: "system", content: opts.system })
    const signal = requestSignal(opts.signal, opts.timeoutMs ?? this.cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const res = await fetchWithRetry(this.fetchImpl, "openai-compatible", `${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        ...(opts.params ?? {}),
        model: this.cfg.model,
        stream: true,
        stream_options: { include_usage: true },
        ...(this.cfg.maxTokens ? { max_tokens: this.cfg.maxTokens } : {}),
        messages: chat,
        tools: tools.length ? tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } })) : undefined,
      }),
      signal,
    }, [429, 502, 503])

    const toolAcc = new Map<number, { id?: string; name?: string; args: string }>()
    const usage: Usage = { inputTokens: 0, outputTokens: 0 }
    let content = ""
    for await (const { data } of readSSE(res.body)) {
      if (data === "[DONE]") break
      let chunk: {
        choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[]
        usage?: {
          prompt_tokens?: number
          completion_tokens?: number
          prompt_tokens_details?: { cached_tokens?: number }
          completion_tokens_details?: { reasoning_tokens?: number }
        }
      }
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      if (chunk.usage) {
        usage.inputTokens = chunk.usage.prompt_tokens ?? usage.inputTokens
        usage.outputTokens = chunk.usage.completion_tokens ?? usage.outputTokens
        usage.reasoningTokens = chunk.usage.completion_tokens_details?.reasoning_tokens
        usage.cacheReadTokens = chunk.usage.prompt_tokens_details?.cached_tokens
      }
      const choice = chunk.choices?.[0]
      if (!choice) continue
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
      .map(([, a]) => {
        let parsed: unknown
        try {
          parsed = a.args ? JSON.parse(a.args) : {}
        } catch {
          parsed = a.args ? { _raw: a.args, _parseError: "Invalid JSON for tool args — did you batch multiple calls? Emit N separate tool calls instead (one JSON object per call)." } : {}
        }
        return { id: a.id ?? `call_${a.name ?? "unknown"}`, name: a.name ?? "", input: parsed }
      })
      .filter((c) => c.name)
    for (const c of calls) yield { type: "toolCall", ...c }
    const hasUsage = usage.inputTokens > 0 || usage.outputTokens > 0
    yield { type: "done", content: content || null, ...(hasUsage ? { usage } : {}) }
  }
}
