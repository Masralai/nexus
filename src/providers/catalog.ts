/**
 * Pinned model catalog snapshot.
 *
 * Capability checks read this catalog, never model-name heuristics. Unknown
 * models fall back to a conservative entry rather than guessing from a prefix.
 */

export interface ModelCost {
  input: number
  output: number
}

export interface ModelInfo {
  id: string
  contextWindow: number
  maxOutput: number
  tools: boolean
  vision: boolean
  reasoning: boolean
  caching: boolean
  cost: ModelCost
}

const MB = 1_000_000

const ENTRIES: ModelInfo[] = [
  { id: "claude-sonnet-4-20250514", contextWindow: 200_000, maxOutput: 64_000, tools: true, vision: true, reasoning: true, caching: true, cost: { input: 3, output: 15 } },
  { id: "claude-opus-4-20250514", contextWindow: 200_000, maxOutput: 32_000, tools: true, vision: true, reasoning: true, caching: true, cost: { input: 15, output: 75 } },
  { id: "claude-3-5-haiku-latest", contextWindow: 200_000, maxOutput: 8_192, tools: true, vision: true, reasoning: false, caching: true, cost: { input: 0.8, output: 4 } },
  { id: "gpt-4o", contextWindow: 128_000, maxOutput: 16_384, tools: true, vision: true, reasoning: false, caching: true, cost: { input: 2.5, output: 10 } },
  { id: "gpt-4o-mini", contextWindow: 128_000, maxOutput: 16_384, tools: true, vision: true, reasoning: false, caching: true, cost: { input: 0.15, output: 0.6 } },
  { id: "o3-mini", contextWindow: 200_000, maxOutput: 100_000, tools: true, vision: false, reasoning: true, caching: false, cost: { input: 1.1, output: 4.4 } },
  { id: "gemini-2.5-pro", contextWindow: MB, maxOutput: 65_536, tools: true, vision: true, reasoning: true, caching: true, cost: { input: 1.25, output: 10 } },
  { id: "gemini-2.5-flash", contextWindow: MB, maxOutput: 65_536, tools: true, vision: true, reasoning: true, caching: true, cost: { input: 0.3, output: 2.5 } },
  { id: "gemini-2.0-flash", contextWindow: MB, maxOutput: 8_192, tools: true, vision: true, reasoning: false, caching: true, cost: { input: 0.1, output: 0.4 } },
  { id: "deepseek-chat", contextWindow: 128_000, maxOutput: 8_192, tools: true, vision: false, reasoning: false, caching: true, cost: { input: 0.27, output: 1.1 } },
  { id: "deepseek-reasoner", contextWindow: 128_000, maxOutput: 8_192, tools: false, vision: false, reasoning: true, caching: true, cost: { input: 0.55, output: 2.19 } },
  { id: "llama-3.3-70b-versatile", contextWindow: 128_000, maxOutput: 32_768, tools: true, vision: false, reasoning: false, caching: false, cost: { input: 0.59, output: 0.79 } },
  { id: "llama-3.1-8b-instant", contextWindow: 128_000, maxOutput: 8_192, tools: true, vision: false, reasoning: false, caching: false, cost: { input: 0.05, output: 0.08 } },
  { id: "mistral-large-latest", contextWindow: 128_000, maxOutput: 8_192, tools: true, vision: false, reasoning: false, caching: false, cost: { input: 2, output: 6 } },
  { id: "grok-4", contextWindow: 256_000, maxOutput: 64_000, tools: true, vision: true, reasoning: true, caching: true, cost: { input: 3, output: 15 } },
  { id: "command-r-plus", contextWindow: 128_000, maxOutput: 4_096, tools: true, vision: false, reasoning: false, caching: false, cost: { input: 2.5, output: 10 } },
]

const FALLBACK: ModelInfo = {
  id: "unknown",
  contextWindow: 128_000,
  maxOutput: 8_192,
  tools: true,
  vision: false,
  reasoning: false,
  caching: false,
  cost: { input: 0, output: 0 },
}

const byId = new Map(ENTRIES.map((entry) => [entry.id.toLowerCase(), entry]))

export function getModelInfo(model: string): ModelInfo {
  const key = model.toLowerCase().replace(/^[a-z0-9._-]+\//, "")
  const exact = byId.get(key)
  if (exact) return exact
  // Longest matching snapshot entry wins. This is catalog lookup, not capability inference.
  let best: ModelInfo | undefined
  for (const [id, entry] of byId) {
    if (key.includes(id) && (!best || id.length > best.id.length)) best = entry
  }
  return best ?? FALLBACK
}

/**
 * Estimate cost in USD. `inputTokens` is total prompt tokens including cache
 * reads/writes (providers normalize to that). Cache reads bill at 10% of input,
 * cache writes at 125%.
 */
export function estimateCost(
  info: ModelInfo,
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  },
): number {
  const cacheRead = usage.cacheReadTokens ?? 0
  const cacheWrite = usage.cacheWriteTokens ?? 0
  const input = Math.max(0, usage.inputTokens - cacheRead - cacheWrite)
  return (
    (input / MB) * info.cost.input +
    (cacheRead / MB) * info.cost.input * 0.1 +
    (cacheWrite / MB) * info.cost.input * 1.25 +
    (usage.outputTokens / MB) * info.cost.output
  )
}

