import type { Message } from "./types"

/** First line of raw text, capped for pickers and session titles. */
export function titleFromText(text: string): string | undefined {
  const line = text.split("\n")[0]?.trim() ?? ""
  if (!line) return undefined
  return line.length > 200 ? `${line.slice(0, 200)}…` : line
}

/** First non-synthetic user line, capped for pickers and session titles. */
export function titleFromMessages(messages: readonly Message[]): string | undefined {
  const firstUser = messages.find(
    (m): m is Extract<Message, { role: "user" }> =>
      m.role === "user" && m.synthetic !== "compaction" && m.content.trim().length > 0,
  )
  return firstUser ? titleFromText(firstUser.content) : undefined
}

export function sessionTitle(messages: readonly Message[]): string {
  return titleFromMessages(messages) ?? ""
}

export function sessionDisplayTitle(
  meta: { id: string; title?: string },
  messages: readonly Message[] = [],
): string {
  return meta.title || titleFromMessages(messages) || `${meta.id.slice(0, 8)}…`
}
