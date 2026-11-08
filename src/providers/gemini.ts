import type { Message, ToolDefinition } from "../engine/types"
import type { Provider, ProviderEvent, StreamOptions, Usage } from "./types"
import { fetchWithRetry, requestSignal } from "./retry"
import { readSSE } from "./sse"

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta"

export interface GeminiConfig {
  apiKey: string
  model: string
  contextWindow: number
  baseUrl?: string
  maxTokens?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

type Part =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: unknown } }
  | { functionResponse: { name: string; response: unknown } }

interface Content {
  role: "user" | "model"
  parts: Part[]
}

export function toGeminiContents(messages: Message[]): Content[] {
  const out: Content[] = []
  const push = (role: "user" | "model", parts: Part[]) => {
    const previous = out[out.length - 1]
    if (previous?.role === role) previous.parts.push(...parts)
    else out.push({ role, parts })
  }
  for (const message of messages) {
    if (message.role === "assistant" && message.content === null && !message.toolCalls?.length) continue
    if (message.role === "user") {
      const parts: Part[] = []
      if (message.content) parts.push({ text: message.content })
      for (const image of message.images ?? []) {
        parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } })
      }
      push("user", parts.length ? parts : [{ text: "" }])
    } else if (message.role === "assistant") {
      const parts: Part[] = []
      if (message.content) parts.push({ text: message.content })
      for (const call of message.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.input ?? {} } })
      }
      if (parts.length) push("model", parts)
    } else {
      push("user", [
        {
          functionResponse: {
            name: message.name,
            response: message.result.error
              ? { output: message.result.output, error: message.result.error }
              : { output: message.result.output },
          },
        },
      ])
    }
  }
  return out
}

export class Gemini implements Provider {
  readonly id = "gemini"
  readonly contextWindow: number
  readonly maxOutputTokens: number
  readonly supportsCaching = true
  private fetchImpl: typeof fetch

  constructor(private cfg: GeminiConfig) {
    this.contextWindow = cfg.contextWindow
    this.maxOutputTokens = cfg.maxTokens ?? 8_192
    this.fetchImpl = cfg.fetchImpl ?? fetch
  }

  async *stream(messages: Message[], tools: ToolDefinition[], opts: StreamOptions): AsyncIterable<ProviderEvent> {
    const base = (this.cfg.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "")
    const signal = requestSignal(opts.signal, opts.timeoutMs ?? this.cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const url = `${base}/models/${encodeURIComponent(this.cfg.model)}:streamGenerateContent?alt=sse`
    const res = await fetchWithRetry(
      this.fetchImpl,
      "gemini",
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.cfg.apiKey },
        body: JSON.stringify({
          ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
          contents: toGeminiContents(messages),
          ...(tools.length
            ? {
                tools: [
                  {
                    functionDeclarations: tools.map((tool) => ({
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.schema,
                    })),
                  },
                ],
              }
            : {}),
          generationConfig: { ...(opts.params ?? {}), maxOutputTokens: this.maxOutputTokens },
        }),
        signal,
      },
      [429, 500, 502, 503, 504],
    )

    const usage: Usage = { inputTokens: 0, outputTokens: 0 }
    let content = ""
    let callIndex = 0
    for await (const { data } of readSSE(res.body)) {
      if (!data || data === "[DONE]") continue
      let chunk: {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string; functionCall?: { name?: string; args?: unknown } }> }
          finishReason?: string
        }>
        usageMetadata?: {
          promptTokenCount?: number
          candidatesTokenCount?: number
          thoughtsTokenCount?: number
          cachedContentTokenCount?: number
        }
      }
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      if (chunk.usageMetadata) {
        usage.inputTokens = chunk.usageMetadata.promptTokenCount ?? usage.inputTokens
        usage.outputTokens = chunk.usageMetadata.candidatesTokenCount ?? usage.outputTokens
        usage.reasoningTokens = chunk.usageMetadata.thoughtsTokenCount
        usage.cacheReadTokens = chunk.usageMetadata.cachedContentTokenCount
      }
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.text) {
          content += part.text
          yield { type: "token", text: part.text }
        }
        if (part.functionCall?.name) {
          yield {
            type: "toolCall",
            id: `call_${part.functionCall.name}_${callIndex++}`,
            name: part.functionCall.name,
            input: part.functionCall.args ?? {},
          }
        }
      }
    }
    const hasUsage = usage.inputTokens > 0 || usage.outputTokens > 0
    yield { type: "done", content: content || null, ...(hasUsage ? { usage } : {}) }
  }
}
