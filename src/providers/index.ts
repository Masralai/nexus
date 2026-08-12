import { Anthropic } from "./anthropic"
import { OpenAICompatible } from "./openai-compatible"
import { MockProvider } from "./mock"
import type { Provider } from "./types"

export function createProvider(cfg: {
  provider: string
  model: string
  apiKey?: string
  baseUrl?: string
  contextWindow?: number
}): Provider {
  if (cfg.provider === "mock") return new MockProvider()
  if (cfg.provider === "anthropic") {
    return new Anthropic({ apiKey: cfg.apiKey ?? "", model: cfg.model, contextWindow: cfg.contextWindow ?? 200_000 })
  }
  return new OpenAICompatible({
    apiKey: cfg.apiKey ?? "",
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    contextWindow: cfg.contextWindow ?? 128_000,
  })
}