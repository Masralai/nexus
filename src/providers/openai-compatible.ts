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

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    const maxRetries = 1
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await this.fetchImpl(url, init)
      if (res.ok) return res
      const retryable = res.status === 429 || res.status === 503 || res.status === 502
      if (!retryable || attempt === maxRetries) {
        throw new Error(`openai-compatible: HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`)
      }
      const retryAfter = res.headers.get("retry-after")
      const delayMs = retryAfter ? Number(retryAfter) * 1000 : 500 * Math.pow(2, attempt)
      if (init.signal?.aborted) throw new Error("aborted")
      await new Promise((r) => setTimeout(r, Math.min(delayMs, 5000)))
    }
    throw new Error("openai-compatible: retry exhausted")
  }

  async *stream(messages: Message[], tools: ToolDefinition[], opts: StreamOptions): AsyncIterable<ProviderEvent> {
    const base = (this.cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")
    const res = await this.fetchWithRetry(`${base}/chat/completions`, {
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
      .map(([, a]) => {
        let parsed: unknown
        try {
          parsed = a.args ? JSON.parse(a.args) : {}
        } catch {
          // Hint for batched JSON like {"path":"a"}{"path":"b"} — instruct model to use N separate calls
          parsed = a.args ? { _raw: a.args, _parseError: "Invalid JSON for tool args — did you batch multiple calls? Emit N separate tool calls instead (one JSON object per call)." } : {}
        }
        // if parseArgs would have returned string, wrap; but we already handle
        return { id: a.id ?? `call_${a.name ?? "unknown"}`, name: a.name ?? "", input: parsed }
      })
      .filter((c) => c.name)
    if (calls.length > 0) {
      for (const c of calls) yield { type: "toolCall", ...c }
    }
    yield { type: "done", content: content || null }
  }
}