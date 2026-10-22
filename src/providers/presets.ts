export type AdapterId = "anthropic" | "openai-compatible"

export interface Preset {
  id: string
  label: string
  adapter: AdapterId
  baseUrl?: string
  suggestedModels: string[]
  /** Env vars checked in order (first non-empty wins), before credentials file. Never shared across presets. */
  envKeys: string[]
  /** Local providers such as Ollama and mock need no credential. */
  requiresKey: boolean
}

export const PRESETS: Preset[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    adapter: "anthropic",
    suggestedModels: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3-5-haiku-latest"],
    envKeys: ["ANTHROPIC_API_KEY"],
    requiresKey: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    adapter: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    suggestedModels: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    envKeys: ["OPENAI_API_KEY"],
    requiresKey: true,
  },
  {
    id: "gemini",
    label: "Google Gemini",
    adapter: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    suggestedModels: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    requiresKey: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    adapter: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    suggestedModels: ["anthropic/claude-sonnet-4", "openai/gpt-4o", "google/gemini-2.5-pro"],
    envKeys: ["OPENROUTER_API_KEY"],
    requiresKey: true,
  },
  {
    id: "groq",
    label: "Groq",
    adapter: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    suggestedModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    envKeys: ["GROQ_API_KEY"],
    requiresKey: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    adapter: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    suggestedModels: ["deepseek-chat", "deepseek-reasoner"],
    envKeys: ["DEEPSEEK_API_KEY"],
    requiresKey: true,
  },
  {
    id: "xai",
    label: "xAI",
    adapter: "openai-compatible",
    baseUrl: "https://api.x.ai/v1",
    suggestedModels: ["grok-4"],
    envKeys: ["XAI_API_KEY"],
    requiresKey: true,
  },
  {
    id: "mistral",
    label: "Mistral",
    adapter: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    suggestedModels: ["mistral-large-latest"],
    envKeys: ["MISTRAL_API_KEY"],
    requiresKey: true,
  },
  {
    id: "cohere",
    label: "Cohere",
    adapter: "openai-compatible",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    suggestedModels: ["command-r-plus"],
    envKeys: ["COHERE_API_KEY"],
    requiresKey: true,
  },
  {
    id: "ollama",
    label: "Ollama",
    adapter: "openai-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    suggestedModels: ["llama3.2", "qwen2.5-coder", "deepseek-r1"],
    envKeys: [],
    requiresKey: false,
  },
]

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id)
}

export function otherPreset(id: string, baseUrl: string): Preset {
  return {
    id,
    label: id,
    adapter: "openai-compatible",
    baseUrl,
    suggestedModels: [],
    // A custom endpoint must never inherit a known provider's key.
    envKeys: [`${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`],
    requiresKey: true,
  }
}
