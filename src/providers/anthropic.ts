import type { Message, ToolDefinition } from "../engine/types"
import type { Provider, ProviderEvent, StreamOptions } from "./types"
import { parseArgs } from "./openai-compatible"
import { readSSE } from "./sse"

export interface AnthropicConfig {
  apiKey: string
  model: string
  contextWindow: number
  maxTokens?: number
  fetchImpl?: typeof fetch
}

type Block =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
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
    ;(m.content[0] as { cache_control?: { type: "ephemeral" } }).cache_control = { type: "ephemeral" }
  }
}

export function toAnthropicMessages(messages: Message[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = []
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content })
    } else if (m.role === "assistant") {
      const content: Block[] = []
      if (m.content) content.push({ type: "text", text: m.content })
      for (const tc of m.toolCalls ?? []) content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input ?? {} })
      out.push({ role: "assistant", content })
    } else {
      out.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.result.error ? `${m.result.output}\n[error] ${m.result.error}` : m.result.output }],
      })
    }
  }
  if (out.length > 0) mark(out[out.length - 1])
  if (out.length > 2) mark(out[1])
  return out
}

export class Anthropic implements Provider {
  readonly id = "anthropic"
  readonly contextWindow: number
  readonly supportsCaching = true
  private fetchImpl: typeof fetch

  constructor(private cfg: AnthropicConfig) {
    this.contextWindow = cfg.contextWindow
    this.fetchImpl = cfg.fetchImpl ?? fetch
  }

  async *stream(messages: Message[], tools: ToolDefinition[], opts: StreamOptions): AsyncIterable<ProviderEvent> {
    const res = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": this.cfg.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: this.cfg.model,
        max_tokens: this.cfg.maxTokens ?? 4096,
        stream: true,
        tools: tools.length ? tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })) : undefined,
        messages: toAnthropicMessages(messages),
      }),
      signal: opts.signal,
    })
    if (!res.ok) throw new Error(`anthropic: HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`)

    const toolAcc = new Map<number, { id?: string; name?: string; input: string }>()
    let content = ""
    let stopReason: string | null = null
    for await (const { event, data } of readSSE(res.body)) {
      if (!data) continue
      let ev: { index?: number; content_block?: { type: string; id?: string; name?: string; input?: unknown }; delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string } }
      try {
        ev = JSON.parse(data)
      } catch {
        continue
      }
      if (event === "content_block_start") {
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
        stopReason = ev.delta?.stop_reason ?? null
      }
    }

    const calls = [...toolAcc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, a]) => ({ id: a.id ?? "", name: a.name ?? "", input: parseArgs(a.input) }))
    if (stopReason === "tool_use" && calls.length > 0) {
      for (const c of calls) yield { type: "toolCall", ...c }
      yield { type: "done", content: content || null }
    } else {
      yield { type: "done", content: content || null }
    }
  }
}