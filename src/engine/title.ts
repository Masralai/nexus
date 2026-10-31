import type { Message } from "./types"
import type { Provider } from "../providers/types"

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

/** Clean a model-produced title: one line, no quoting or filler, bounded length. */
export function cleanTitle(raw: string): string | undefined {
  const line = raw
    .split("\n")
    .map((item) => item.trim())
    .find(Boolean)
  if (!line) return undefined
  const title = line
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(?:session\s+)?title\s*:\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!title) return undefined
  return title.length > 80 ? `${title.slice(0, 79)}…` : title
}

/**
 * Generate a short Session title from the first exchange. Uses an injected
 * provider so the caller controls cost (titleModel/compactModel in config).
 */
export async function generateTitle(
  provider: Provider,
  messages: readonly Message[],
  opts: { signal?: AbortSignal; params?: Record<string, unknown> } = {},
): Promise<string | undefined> {
  const firstUser = messages.find(
    (m): m is Extract<Message, { role: "user" }> =>
      m.role === "user" && m.synthetic !== "compaction" && m.content.trim().length > 0,
  )
  if (!firstUser) return undefined
  const firstAssistant = messages.find(
    (m): m is Extract<Message, { role: "assistant" }> =>
      m.role === "assistant" && typeof m.content === "string" && m.content.trim().length > 0,
  )
  const prompt = [
    "Write a short title for this coding session.",
    "Return only the title, 3 to 6 words, no quotes, no trailing period.",
    "",
    `User: ${firstUser.content.slice(0, 2_000)}`,
    ...(firstAssistant ? [`Assistant: ${(firstAssistant.content ?? "").slice(0, 2_000)}`] : []),
  ].join("\n")
  let out = ""
  for await (const event of provider.stream([{ role: "user", content: prompt }], [], opts)) {
    if (event.type === "token") out += event.text
    else if (event.type === "done" && event.content) out = event.content
  }
  return cleanTitle(out)
}
