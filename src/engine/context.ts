import type { Message } from "./types"
import type { AgentMode } from "./mode"
import { modePolicy } from "./mode"
import type { Provider } from "../providers/types"
import { compactMessages, shouldCompact } from "./compact"
import { formatSkillsPrompt, type Skill } from "../skills"

export function truncate(text: string, max = 4000): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[...truncated ${text.length - max} chars]`
}

export function approxTokens(m: Message): number {
  const text = m.role === "tool" ? m.result.output + (m.result.error ?? "") : (m.content ?? "")
  return Math.ceil(text.length / 4)
}

const GUIDANCE = `You are Nexus, a coding assistant in a chat shell.
Prefer a normal conversational reply in plain text.
Do not use tools for greetings, chitchat, or questions you can answer without the repo.
Use tools only when the user wants file, shell, or repository work.
If a tool returns "permission denied", the user declined that tool — say that; do not invent OS/sandbox permission failures.`

export function workingMemory(
  messages: Message[],
  mode: AgentMode = "build",
  skills: Skill[] = [],
): string {
  const users = messages.filter((m) => m.role === "user")
  const task = users.at(-1)?.content ?? ""
  const recent = messages
    .slice(-4)
    .map((m) => (m.role === "tool" ? `[${m.name}] ${m.result.output.slice(0, 120)}` : (m.content ?? "").slice(0, 120)))
    .join("\n")
  const { guidance } = modePolicy(mode)
  const skillBlock = formatSkillsPrompt(skills)
  const skillsSection = skillBlock ? `\n\n${skillBlock}` : ""
  return `[working-memory]
${GUIDANCE}${guidance}${skillsSection}

task: ${task.slice(0, 300)}
recent:
${recent}`
}

export function budgetUsed(messages: Message[]): number {
  return messages.reduce((n, m) => n + approxTokens(m), 0)
}

export function budgetPct(messages: Message[], limit: number): number {
  return budgetUsed(messages) / limit
}

/**
 * Build the provider prompt for a turn step.
 * Durable session messages are unchanged; truncation is prompt-only.
 */
export function assemblePrompt(
  messages: Message[],
  mode: AgentMode = "build",
  skills: Skill[] = [],
): Message[] {
  return [
    { role: "user", content: workingMemory(messages, mode, skills) },
    ...messages.map((m) =>
      m.role === "tool" ? { ...m, result: { ...m.result, output: truncate(m.result.output) } } : m,
    ),
  ]
}

export interface CompactConfig {
  provider: Provider
  threshold?: number
  keepRecent?: number
  limit: number
}

/** Compact in-memory messages when over threshold; returns whether compaction ran. */
export async function maybeCompact(messages: Message[], cfg: CompactConfig): Promise<boolean> {
  const threshold = cfg.threshold ?? 0.8
  const keepRecent = cfg.keepRecent ?? 6
  if (!shouldCompact(budgetPct(messages, cfg.limit), threshold)) return false
  const next = await compactMessages(messages, cfg.provider, keepRecent)
  messages.length = 0
  messages.push(...next)
  return true
}
