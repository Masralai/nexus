import type { Message } from "./types"
import type { Provider } from "../providers/types"

export function shouldCompact(pct: number, threshold = 0.8): boolean {
  return pct >= threshold
}

export async function summarize(cheap: Provider, head: Message[]): Promise<string> {
  const blob = head
    .map((m) => {
      if (m.role === "tool") return `${m.name}: ${m.result.output.slice(0, 500)}`
      return `${m.role}: ${(m.content ?? "").slice(0, 500)}`
    })
    .join("\n")
  let out = ""
  for await (const ev of cheap.stream(
    [{ role: "user", content: `Summarize for agent continuity:\n${blob}` }],
    [],
    {},
  )) {
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
