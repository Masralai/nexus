import type { Message } from "./types"
import type { Provider } from "../providers/types"

export function shouldCompact(pct: number, threshold = 0.8): boolean {
  return pct >= threshold
}

export async function summarize(cheap: Provider, head: Message[]): Promise<string> {
  const blob = head
    .map((m) => {
      if (m.role === "tool") {
        const loc = m.name ? `${m.name} ${m.toolCallId ?? ""}` : "tool"
        return `${loc}: ${m.result.output.slice(0, 800)}${m.result.error ? ` [error: ${m.result.error}]` : ""}`
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        const calls = m.toolCalls.map((c) => `${c.name}:${JSON.stringify(c.input).slice(0, 300)}`).join(", ")
        return `assistant: ${(m.content ?? "").slice(0, 500)} | toolCalls: ${calls}`
      }
      return `${m.role}: ${(m.content ?? "").slice(0, 800)}`
    })
    .join("\n")
  const prompt = `Summarize for agent continuity. Preserve file paths, line numbers, errors, and open TODOs. Keep a compact bullet list of key findings and next steps.\n\n${blob}`
  let out = ""
  for await (const ev of cheap.stream([{ role: "user", content: prompt }], [], {})) {
    if (ev.type === "token") out += ev.text
    else if (ev.type === "done" && ev.content) out = ev.content
  }
  return out || "(empty summary)"
}

export async function compactMessages(
  messages: readonly Message[],
  cheap: Provider,
  keepRecent = 6,
): Promise<Message[]> {
  if (messages.length <= keepRecent) return messages.slice()
  const tail = messages.slice(-keepRecent)
  const head = messages.slice(0, -keepRecent)
  const summary = await summarize(cheap, head)
  return [{ role: "user", content: `[prior context]\n${summary}` }, ...tail]
}
