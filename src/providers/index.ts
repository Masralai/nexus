import { Anthropic } from "./anthropic"
import { Gemini } from "./gemini"
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
  if (cfg.provider === "azure") {
    if (!cfg.baseUrl) throw new Error("azure: set AZURE_OPENAI_ENDPOINT or NEXUS_BASE_URL")
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21"
    const endpoint = (base: string, model: string) => {
      const root = base.replace(/\/$/, "")
      const path = root.includes("/deployments/")
        ? `${root}/chat/completions`
        : `${root}/openai/deployments/${encodeURIComponent(model)}/chat/completions`
      return `${path}?api-version=${encodeURIComponent(apiVersion)}`
    }
    return new OpenAICompatible({
      apiKey: cfg.apiKey ?? "",
      model: cfg.model,
      contextWindow,
      baseUrl: cfg.baseUrl,
      maxTokens: cfg.maxTokens,
      timeoutMs: cfg.timeoutMs,
      endpoint,
      apiKeyHeader: "api-key",
      id: "azure",
    })
  }
  if (cfg.provider === "gemini") {
    return new Gemini({
      apiKey: cfg.apiKey ?? "",
      model: cfg.model,
      contextWindow,
      baseUrl: cfg.baseUrl,
      maxTokens: cfg.maxTokens,
      timeoutMs: cfg.timeoutMs,
    })
  }
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
