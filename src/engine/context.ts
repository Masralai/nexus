import type { Message } from "./types"

export function truncate(text: string, max = 4000): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[...truncated ${text.length - max} chars]`
}

export function approxTokens(m: Message): number {
  const text = m.role === "tool" ? m.result.output + (m.result.error ?? "") : (m.content ?? "")
  return Math.ceil(text.length / 4)
}

export function workingMemory(messages: Message[]): string {
  const task = messages.find((m) => m.role === "user")?.content ?? ""
  const recent = messages
    .slice(-4)
    .map((m) => (m.role === "tool" ? `[${m.name}] ${m.result.output.slice(0, 120)}` : (m.content ?? "").slice(0, 120)))
    .join("\n")
  return `[working-memory]\ntask: ${task.slice(0, 300)}\nrecent:\n${recent}`
}