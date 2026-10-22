import type { Message } from "./types"
import type { Provider } from "../providers/types"
import { compactMessages, safeSplit, shouldCompact } from "./compact"

/** Approximate chars-per-token for budgeting. Deliberately conservative. */
export const CHARS_PER_TOKEN = 4

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
export function truncateTool(name: string, output: string): string {
  return truncate(output, toolBudget(name) * CHARS_PER_TOKEN)
}

export function approxTokens(m: Message): number {
  let text: string
  if (m.role === "tool") text = m.result.output + (m.result.error ?? "")
  else if (m.role === "assistant" && m.toolCalls?.length) {
    const callsText = m.toolCalls.map((c) => `${c.name}:${JSON.stringify(c.input)}`).join("")
    text = (m.content ?? "") + callsText
  } else text = m.content ?? ""
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function approxTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function budgetUsed(messages: readonly Message[], extraTokens = 0): number {
  return messages.reduce((n, m) => n + approxTokens(m), 0) + extraTokens
}

export function budgetPct(messages: readonly Message[], limit: number, extraTokens = 0): number {
  return budgetUsed(messages, extraTokens) / limit
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
export function buildPrompt(messages: readonly Message[], system: string): BuiltPrompt {
  return {
    system,
    messages: messages.map((m) =>
      m.role === "tool"
        ? { ...m, result: { ...m.result, output: truncateTool(m.name, m.result.output) } }
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
}

/** Compact when over threshold. Returns a new list, or null if compaction did not run. Never mutates input. */
export async function maybeCompact(messages: readonly Message[], cfg: CompactConfig): Promise<Message[] | null> {
  const threshold = cfg.threshold ?? 0.8
  const keepRecent = cfg.keepRecent ?? 6
  if (!shouldCompact(budgetPct(messages, cfg.limit, cfg.systemTokens), threshold)) return null
  // Nothing can be summarized without dropping the active request or recent tail.
  if (safeSplit(messages, keepRecent) === 0) return null
  return compactMessages(messages, cfg.provider, keepRecent, cfg.params)
}
