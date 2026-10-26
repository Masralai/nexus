import type { Message, ToolDefinition } from "../engine/types"
import type { Provider, ProviderEvent, StreamOptions, Usage } from "./types"
import { fetchWithRetry, requestSignal } from "./retry"
import { readSSE } from "./sse"

const DEFAULT_TIMEOUT_MS = 120_000

export interface AnthropicConfig {
  apiKey: string
  model: string
  contextWindow: number
  /** Anthropic requires an output token limit on every request. */
  maxTokens?: number
  /** Wall-clock limit for one streaming request. Timeouts stay distinct from aborts. */
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

type Block =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; cache_control?: { type: "ephemeral" } }

interface AnthropicMessage {
  role: "user" | "assistant"
  content: string | Block[]
}

function mark(m: AnthropicMessage): void {
  if (typeof m.content === "string") {
    m.content = [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }]
  } else if (m.content.length > 0) {
    const first = m.content[0]
    if (first.type === "text" || first.type === "tool_result") first.cache_control = { type: "ephemeral" }
  }
}

export function toAnthropicMessages(messages: Message[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = []
  const pushUser = (blocks: Block[]) => {
    const previous = out[out.length - 1]
    if (previous?.role === "user" && Array.isArray(previous.content)) {
      previous.content.push(...blocks)
      return
    }
    out.push({ role: "user", content: blocks })
  }
  for (const m of messages) {
    if (m.role === "assistant" && m.content === null && !(m.toolCalls?.length)) continue
    if (m.role === "user") {
      const blocks: Block[] = []
      if (m.content) blocks.push({ type: "text", text: m.content })
      for (const image of m.images ?? []) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: image.mimeType, data: image.data },
        })
      }
      if (blocks.length === 0) blocks.push({ type: "text", text: "" })
      pushUser(blocks)
    } else if (m.role === "assistant") {
      const content: Block[] = []
      if (m.content) content.push({ type: "text", text: m.content })
      for (const tc of m.toolCalls ?? []) content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input ?? {} })
      out.push({ role: "assistant", content })
    } else {
      pushUser([
        {
          type: "tool_result",
          tool_use_id: m.toolCallId,
          content: m.result.error ? `${m.result.output}\n[error] ${m.result.error}` : m.result.output,
        },
      ])
    }
  }
  if (out.length > 0) mark(out[out.length - 1])
  if (out.length > 2) mark(out[1])
  return out
}

export class Anthropic implements Provider {
  readonly id = "anthropic"
  readonly contextWindow: number
  readonly maxOutputTokens: number
  readonly supportsCaching = true
  private fetchImpl: typeof fetch

  constructor(private cfg: AnthropicConfig) {
    this.contextWindow = cfg.contextWindow
    this.maxOutputTokens = cfg.maxTokens ?? 8_192
    this.fetchImpl = cfg.fetchImpl ?? fetch
  }

  async *stream(messages: Message[], tools: ToolDefinition[], opts: StreamOptions): AsyncIterable<ProviderEvent> {
    const signal = requestSignal(opts.signal, opts.timeoutMs ?? this.cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const res = await fetchWithRetry(this.fetchImpl, "anthropic", "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": this.cfg.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        ...(opts.params ?? {}),
        model: this.cfg.model,
        max_tokens: this.maxOutputTokens,
        ...(opts.system ? { system: opts.system } : {}),
        stream: true,
        tools: tools.length ? tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })) : undefined,
        messages: toAnthropicMessages(messages),
      }),
      signal,
    }, [429, 502, 503, 529])

    const toolAcc = new Map<number, { id?: string; name?: string; input: string }>()
    const usage: Usage = { inputTokens: 0, outputTokens: 0 }
    let content = ""
    for await (const { event, data } of readSSE(res.body)) {
      if (!data) continue
      let ev: {
        index?: number
        message?: { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
        content_block?: { type: string; id?: string; name?: string; input?: unknown }
        delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string; usage?: { output_tokens?: number } }
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
      }
      try {
        ev = JSON.parse(data)
      } catch {
        continue
      }
      if (event === "message_start") {
        const start = ev.message?.usage
        const cacheRead = start?.cache_read_input_tokens ?? 0
        const cacheWrite = start?.cache_creation_input_tokens ?? 0
        // Anthropic reports uncached input separately; normalize to total prompt tokens.
        usage.inputTokens = (start?.input_tokens ?? 0) + cacheRead + cacheWrite
        usage.cacheReadTokens = cacheRead || undefined
        usage.cacheWriteTokens = cacheWrite || undefined
      } else if (event === "content_block_start") {
        const cb = ev.content_block
        if (cb?.type === "tool_use") toolAcc.set(ev.index ?? 0, { id: cb.id, name: cb.name, input: "" })
      } else if (event === "content_block_delta") {
        const d = ev.delta
        if (d?.type === "text_delta" && d.text) {
          content += d.text
          yield { type: "token", text: d.text }
        } else if (d?.type === "input_json_delta") {
          const acc = toolAcc.get(ev.index ?? 0)
          if (acc && d.partial_json) acc.input += d.partial_json
        }
      } else if (event === "message_delta") {
        if (ev.delta?.usage?.output_tokens !== undefined) usage.outputTokens = ev.delta.usage.output_tokens
        else if (ev.usage?.output_tokens !== undefined) usage.outputTokens = ev.usage.output_tokens
      }
    }

    const calls = [...toolAcc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, a]) => {
        let parsed: unknown
        try {
          parsed = a.input ? JSON.parse(a.input) : {}
        } catch {
          parsed = a.input ? { _raw: a.input, _parseError: "Invalid JSON for tool args — did you batch multiple calls? Emit N separate tool calls instead (one JSON object per call)." } : {}
        }
        return { id: a.id ?? "", name: a.name ?? "", input: parsed }
      })
      .filter((c) => c.name)
    for (const c of calls) yield { type: "toolCall", ...c }
    const hasUsage = usage.inputTokens > 0 || usage.outputTokens > 0
    yield { type: "done", content: content || null, ...(hasUsage ? { usage } : {}) }
  }
}
