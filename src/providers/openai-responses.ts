import type { Message, ToolDefinition } from "../engine/types"
import type { Provider, ProviderEvent, StreamOptions, Usage } from "./types"
import { fetchWithRetry, requestSignal } from "./retry"
import { readSSE } from "./sse"
import { ProviderError } from "./error"

const DEFAULT_TIMEOUT_MS = 120_000

export interface OpenAIResponsesConfig {
  apiKey: string
  model: string
  contextWindow: number
  baseUrl?: string
  id?: string
  supportsCaching?: boolean
  maxTokens?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

type ResponsesInput =
  | { role: "user" | "assistant"; content: string | Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string }> }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string }

export function toResponsesInput(messages: Message[]): ResponsesInput[] {
  const out: ResponsesInput[] = []
  for (const message of messages) {
    if (message.role === "user") {
      if (message.images?.length) {
        out.push({
          role: "user",
          content: [
            ...(message.content ? [{ type: "input_text" as const, text: message.content }] : []),
            ...message.images.map((image) => ({
              type: "input_image" as const,
              image_url: `data:${image.mimeType};base64,${image.data}`,
            })),
          ],
        })
      } else {
        out.push({ role: "user", content: message.content })
      }
    } else if (message.role === "assistant") {
      if (message.content) out.push({ role: "assistant", content: message.content })
      for (const call of message.toolCalls ?? []) {
        out.push({ type: "function_call", call_id: call.id, name: call.name, arguments: JSON.stringify(call.input) })
      }
    } else {
      out.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: message.result.error ? `${message.result.output}\n[error] ${message.result.error}` : message.result.output,
      })
    }
  }
  return out
}

interface StreamEvent {
  type?: string
  delta?: string
  item_id?: string
  output_index?: number
  arguments?: string
  item?: {
    id?: string
    type?: string
    call_id?: string
    name?: string
    arguments?: string
  }
  response?: {
    usage?: {
      input_tokens?: number
      output_tokens?: number
      input_tokens_details?: { cached_tokens?: number }
      output_tokens_details?: { reasoning_tokens?: number }
    }
    error?: { code?: string; message?: string }
  }
  error?: { code?: string; message?: string }
  message?: string
}

function parseArgs(raw: string): unknown {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {
      _raw: raw,
      _parseError:
        "Invalid JSON for tool args — did you batch multiple calls? Emit N separate tool calls instead (one JSON object per call).",
    }
  }
}

export class OpenAIResponses implements Provider {
  readonly id: string
  readonly contextWindow: number
  readonly maxOutputTokens: number
  readonly supportsCaching: boolean
  private fetchImpl: typeof fetch

  constructor(private cfg: OpenAIResponsesConfig) {
    this.id = cfg.id ?? "openai-responses"
    this.contextWindow = cfg.contextWindow
    this.maxOutputTokens = cfg.maxTokens ?? 8_192
    this.supportsCaching = cfg.supportsCaching ?? false
    this.fetchImpl = cfg.fetchImpl ?? fetch
  }

  async *stream(messages: Message[], tools: ToolDefinition[], opts: StreamOptions): AsyncIterable<ProviderEvent> {
    const base = (this.cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")
    const signal = requestSignal(opts.signal, opts.timeoutMs ?? this.cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const res = await fetchWithRetry(
      this.fetchImpl,
      this.id,
      `${base}/responses`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({
          ...(opts.params ?? {}),
          model: this.cfg.model,
          stream: true,
          input: toResponsesInput(messages),
          ...(opts.system ? { instructions: opts.system } : {}),
          ...(this.cfg.maxTokens ? { max_output_tokens: this.cfg.maxTokens } : {}),
          ...(tools.length
            ? {
                tools: tools.map((tool) => ({
                  type: "function",
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.schema,
                })),
              }
            : {}),
        }),
        signal,
      },
      [429, 502, 503],
    )

    const calls = new Map<string, { id: string; name: string; args: string; index: number }>()
    const usage: Usage = { inputTokens: 0, outputTokens: 0 }
    let content = ""

    for await (const { data } of readSSE(res.body)) {
      if (!data || data === "[DONE]") continue
      let event: StreamEvent
      try {
        event = JSON.parse(data)
      } catch {
        continue
      }

      const failure = event.type === "error" ? event.error : event.type === "response.failed" ? event.response?.error : undefined
      if (failure) {
        throw new ProviderError(this.id, {
          code: failure.code ?? "provider_error",
          message: `${this.id}: ${failure.message ?? "stream failed"}`,
        })
      }

      if (event.type === "response.output_text.delta" && event.delta) {
        content += event.delta
        yield { type: "token", text: event.delta }
        continue
      }

      if (event.type === "response.output_item.added" || event.type === "response.output_item.done") {
        const item = event.item
        if (item?.type === "function_call" && item.name) {
          const key = item.id ?? item.call_id ?? `${event.output_index ?? calls.size}`
          const existing = calls.get(key)
          calls.set(key, {
            id: item.call_id ?? existing?.id ?? key,
            name: item.name,
            args: item.arguments ?? existing?.args ?? "",
            index: event.output_index ?? existing?.index ?? calls.size,
          })
        }
        continue
      }

      if (event.type === "response.function_call_arguments.delta" && event.item_id) {
        const existing = calls.get(event.item_id)
        if (existing) existing.args += event.delta ?? ""
        continue
      }

      if (event.type === "response.function_call_arguments.done" && event.item_id) {
        const existing = calls.get(event.item_id)
        if (existing && event.arguments !== undefined) existing.args = event.arguments
        continue
      }

      if (event.type === "response.completed" && event.response?.usage) {
        const reported = event.response.usage
        usage.inputTokens = reported.input_tokens ?? usage.inputTokens
        usage.outputTokens = reported.output_tokens ?? usage.outputTokens
        usage.reasoningTokens = reported.output_tokens_details?.reasoning_tokens
        usage.cacheReadTokens = reported.input_tokens_details?.cached_tokens
      }
    }

    for (const call of [...calls.values()].sort((a, b) => a.index - b.index)) {
      yield { type: "toolCall", id: call.id, name: call.name, input: parseArgs(call.args) }
    }
    const hasUsage = usage.inputTokens > 0 || usage.outputTokens > 0
    yield { type: "done", content: content || null, ...(hasUsage ? { usage } : {}) }
  }
}
