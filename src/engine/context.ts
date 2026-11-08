import type { Message } from "./types"
import type { Provider } from "../providers/types"
import { compactMessages, safeSplit, shouldCompact } from "./compact"

/** Approximate chars-per-token for budgeting. Deliberately conservative. */
export const CHARS_PER_TOKEN = 4
/** Calibration bounds: never trust a single anomalous provider usage report. */
export const MIN_CHARS_PER_TOKEN = 1.5
export const MAX_CHARS_PER_TOKEN = 8

export function clampCharsPerToken(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return CHARS_PER_TOKEN
  return Math.min(MAX_CHARS_PER_TOKEN, Math.max(MIN_CHARS_PER_TOKEN, value))
}

/**
 * Blend a provider-reported prompt size into the estimator.
 *
 * `estimatedChars` is the actual character count sent to the provider and
 * `actualTokens` is the usage it reported. A single observation is blended
 * slowly so context updates do not oscillate; the result stays clamped to a
 * plausible chars-per-token range.
 */
export function calibrateCharsPerToken(
  estimatedChars: number,
  actualTokens: number,
  current = CHARS_PER_TOKEN,
): number {
  if (!Number.isFinite(actualTokens) || actualTokens <= 0 || !Number.isFinite(estimatedChars) || estimatedChars <= 0) {
    return clampCharsPerToken(current)
  }
  const observed = estimatedChars / actualTokens
  return clampCharsPerToken(current * 0.7 + observed * 0.3)
}

export function truncate(text: string, max = 4000): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[...truncated ${text.length - max} chars]`
}

/**
 * Per-tool output budgets in tokens. A read can be larger than a grep result,
 * but no single tool result may dominate the context window.
 */
export const TOOL_TOKEN_BUDGETS: Record<string, number> = {
  read: 8_000,
  grep: 4_000,
  glob: 2_000,
  list: 4_000,
  bash: 6_000,
  task: 6_000,
  apply_patch: 2_000,
  default: 4_000,
}

export function toolBudget(name: string): number {
  return TOOL_TOKEN_BUDGETS[name] ?? TOOL_TOKEN_BUDGETS.default
}

/** Prompt-only truncation: never mutates the stored message. */
export function truncateTool(name: string, output: string, charsPerToken = CHARS_PER_TOKEN): string {
  return truncate(output, toolBudget(name) * clampCharsPerToken(charsPerToken))
}

/** Character count of the text a provider actually sees for one message. */
export function messageChars(m: Message): number {
  let text: string
  if (m.role === "tool") text = m.result.output + (m.result.error ?? "")
  else if (m.role === "assistant" && m.toolCalls?.length) {
    const callsText = m.toolCalls.map((c) => `${c.name}:${JSON.stringify(c.input)}`).join("")
    text = (m.content ?? "") + callsText
  } else text = m.content ?? ""
  return text.length
}

/** Character count of a full prompt, used to calibrate the estimator. */
export function promptChars(messages: readonly Message[], system = ""): number {
  return messages.reduce((n, m) => n + messageChars(m), 0) + system.length
}

export function approxTokens(m: Message, charsPerToken = CHARS_PER_TOKEN): number {
  return Math.ceil(messageChars(m) / clampCharsPerToken(charsPerToken))
}

export function approxTextTokens(text: string, charsPerToken = CHARS_PER_TOKEN): number {
  return Math.ceil(text.length / clampCharsPerToken(charsPerToken))
}

export function budgetUsed(
  messages: readonly Message[],
  extraTokens = 0,
  charsPerToken = CHARS_PER_TOKEN,
): number {
  return messages.reduce((n, m) => n + approxTokens(m, charsPerToken), 0) + extraTokens
}

export function budgetPct(
  messages: readonly Message[],
  limit: number,
  extraTokens = 0,
  charsPerToken = CHARS_PER_TOKEN,
): number {
  return budgetUsed(messages, extraTokens, charsPerToken) / limit
}

export interface BuiltPrompt {
  system: string
  messages: Message[]
}

/**
 * Build the provider prompt for one turn step.
 *
 * Durable session messages are unchanged; tool output truncation is prompt-only.
 * The system channel carries policy and environment, never a fake user message.
 */
export function buildPrompt(
  messages: readonly Message[],
  system: string,
  charsPerToken = CHARS_PER_TOKEN,
): BuiltPrompt {
  return {
    system,
    messages: messages.map((m) =>
      m.role === "tool"
        ? { ...m, result: { ...m.result, output: truncateTool(m.name, m.result.output, charsPerToken) } }
        : m,
    ),
  }
}

export interface CompactConfig {
  provider: Provider
  threshold?: number
  keepRecent?: number
  limit: number
  /** System-prompt tokens count toward the window. */
  systemTokens?: number
  /** Plugin-provided provider parameters. */
  params?: Record<string, unknown>
  /** Calibrated chars-per-token from provider usage, when available. */
  charsPerToken?: number
}

/** Compact when over threshold. Returns a new list, or null if compaction did not run. Never mutates input. */
export async function maybeCompact(messages: readonly Message[], cfg: CompactConfig): Promise<Message[] | null> {
  const threshold = cfg.threshold ?? 0.8
  const keepRecent = cfg.keepRecent ?? 6
  const charsPerToken = cfg.charsPerToken ?? CHARS_PER_TOKEN
  if (!shouldCompact(budgetPct(messages, cfg.limit, cfg.systemTokens, charsPerToken), threshold)) return null
  // Nothing can be summarized without dropping the active request or recent tail.
  if (safeSplit(messages, keepRecent) === 0) return null
  return compactMessages(messages, cfg.provider, keepRecent, cfg.params)
}
