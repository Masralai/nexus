export type AdapterId = "anthropic" | "openai-compatible"

export interface Preset {
  id: string
  label: string
  adapter: AdapterId
  baseUrl?: string
  suggestedModels: string[]
  /** Env vars checked in order (first non-empty wins), before credentials file */
  envKeys: string[]
}

export const PRESETS: Preset[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    adapter: "anthropic",
    suggestedModels: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3-5-haiku-latest"],
    envKeys: ["ANTHROPIC_API_KEY"],
  },
  {
    id: "openai",
    label: "OpenAI",
    adapter: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    suggestedModels: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    envKeys: ["OPENAI_API_KEY"],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    adapter: "openai-compatible",
    // OpenAI-compatible Gemini endpoint
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    suggestedModels: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    adapter: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    suggestedModels: ["anthropic/claude-sonnet-4", "openai/gpt-4o", "google/gemini-2.5-pro"],
    envKeys: ["OPENAI_API_KEY"],
  },
  {
    id: "groq",
    label: "Groq",
    adapter: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    suggestedModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    envKeys: ["OPENAI_API_KEY"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    adapter: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    suggestedModels: ["deepseek-chat", "deepseek-reasoner"],
    envKeys: ["OPENAI_API_KEY"],
  },
  {
    id: "ollama",
    label: "Ollama",
    adapter: "openai-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    suggestedModels: ["llama3.2", "qwen2.5-coder", "deepseek-r1"],
    envKeys: ["OPENAI_API_KEY"],
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
    envKeys: ["OPENAI_API_KEY"],
  }
}
