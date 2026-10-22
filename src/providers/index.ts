import { Anthropic } from "./anthropic"
import { OpenAICompatible } from "./openai-compatible"
import { MockProvider } from "./mock"
import { getModelInfo } from "./catalog"
import type { Provider } from "./types"

export function createProvider(cfg: {
  provider: string
  model: string
  apiKey?: string
  baseUrl?: string
  contextWindow?: number
  maxTokens?: number
  timeoutMs?: number
}): Provider {
  if (cfg.provider === "mock") return new MockProvider()
  const info = getModelInfo(cfg.model)
  const contextWindow = cfg.contextWindow ?? info.contextWindow
  if (cfg.provider === "anthropic") {
    return new Anthropic({
      apiKey: cfg.apiKey ?? "",
      model: cfg.model,
      contextWindow,
      // Anthropic rejects requests without an output limit.
      maxTokens: cfg.maxTokens ?? Math.min(info.maxOutput, 8_192),
      timeoutMs: cfg.timeoutMs,
    })
  }
  return new OpenAICompatible({
    apiKey: cfg.apiKey ?? "",
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    contextWindow,
    maxTokens: cfg.maxTokens,
    timeoutMs: cfg.timeoutMs,
    id: "openai-compatible",
  })
}

export { getModelInfo, estimateCost } from "./catalog"
export type { ModelInfo } from "./catalog"
