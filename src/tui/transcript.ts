import type { Message } from "../engine/types"

function shortInput(input: unknown): string {
  const s = JSON.stringify(input)
  return s.length > 80 ? `${s.slice(0, 80)}…` : s
}

function preview(text: string): string {
  return (text.split("\n")[0] ?? "").slice(0, 120)
}

/** Render persisted session messages as a chat transcript (OpenCode-style). */
export function formatTranscript(messages: Message[]): string[] {
  const lines: string[] = []
  for (const m of messages) {
    if (m.role === "user") {
      lines.push(`you: ${m.content}`)
    } else if (m.role === "assistant") {
      if (m.content) lines.push(m.content)
      for (const call of m.toolCalls ?? []) {
        lines.push(`▶ ${call.name} ${shortInput(call.input)}`)
      }
    } else if (m.role === "tool") {
      const tag = m.result.ok ? "ok" : "error"
      const line = `  ${tag} ${preview(m.result.output)}${m.result.error ? ` [${m.result.error}]` : ""}`
      lines.push(line)
    }
  }
  return lines
}
