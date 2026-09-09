import { Anthropic } from "./anthropic"
import { OpenAICompatible } from "./openai-compatible"
import { MockProvider } from "./mock"
import type { Provider } from "./types"

function inferContextWindow(model: string, fallback: number): number {
  const m = model.toLowerCase()
  if (m.includes("gemini-2.5") || m.includes("gemini-1.5") || m.includes("gemini")) return 1_000_000
  if (m.includes("claude")) return 200_000
  if (m.includes("gpt-4o") || m.includes("o3") || m.includes("o1")) return 128_000
  if (m.includes("llama-3")) return 128_000
  return fallback
}

export function createProvider(cfg: {
  provider: string
  model: string
  apiKey?: string
  baseUrl?: string
  contextWindow?: number
}): Provider {
  if (cfg.provider === "mock") return new MockProvider()
  if (cfg.provider === "anthropic") {
    return new Anthropic({ apiKey: cfg.apiKey ?? "", model: cfg.model, contextWindow: cfg.contextWindow ?? inferContextWindow(cfg.model, 200_000) })
  }
  return new OpenAICompatible({
    apiKey: cfg.apiKey ?? "",
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    contextWindow: cfg.contextWindow ?? inferContextWindow(cfg.model, 128_000),
  })
}