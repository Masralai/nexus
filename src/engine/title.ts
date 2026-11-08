import type { Message, SessionMeta } from "./types"
import type { Provider, Usage } from "../providers/types"
import { estimateCost, getModelInfo } from "../providers/catalog"

/** First line of raw text, capped for pickers and session titles. */
export function titleFromText(text: string): string | undefined {
  const line = text.split("\n")[0]?.trim() ?? ""
  if (!line) return undefined
  return line.length > 200 ? `${line.slice(0, 200)}…` : line
}

/** First real user message: synthetic compaction summaries do not count. */
function firstUser(messages: readonly Message[]): Extract<Message, { role: "user" }> | undefined {
  return messages.find(
    (m): m is Extract<Message, { role: "user" }> =>
      m.role === "user" && m.synthetic !== "compaction" && m.content.trim().length > 0,
  )
}

/** First non-synthetic user line, capped for pickers and session titles. */
export function titleFromMessages(messages: readonly Message[]): string | undefined {
  const user = firstUser(messages)
  return user ? titleFromText(user.content) : undefined
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
  opts: {
    signal?: AbortSignal
    params?: Record<string, unknown>
    /** Report the title model's usage so Session accounting stays complete. */
    onUsage?: (usage: Usage) => void
  } = {},
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
  let usage: Usage | undefined
  for await (const event of provider.stream([{ role: "user", content: prompt }], [], opts)) {
    if (event.type === "token") out += event.text
    else if (event.type === "done") {
      if (event.content) out = event.content
      usage = event.usage
    }
  }
  if (usage) opts.onUsage?.(usage)
  return cleanTitle(out)
}

/** The slice of a Session store the title helper needs. */
export interface TitleStore {
  load(id: string): { meta: SessionMeta; messages: Message[] }
  rename?(id: string, title: string): void
  addUsage?(id: string, usage: Usage, cost?: number): void
}

export interface MaybeTitleOptions {
  /** Skip generation entirely (config.autoTitle === false). */
  disabled?: boolean
  /** Model id used for cost accounting. */
  model?: string
  signal?: AbortSignal
  params?: Record<string, unknown>
  /** Called after the stored title is replaced, so a server can emit an event. */
  onRename?: (title: string) => void
}

/**
 * Replace a heuristic first-line title with a model-generated one.
 *
 * Only the fallback title is replaced: a title the user chose is never
 * overwritten. Title usage is added to the Session counters, and failures stay
 * cosmetic so a completed Turn is never failed by title generation.
 */
export async function maybeGenerateTitle(
  store: TitleStore,
  sessionId: string,
  provider: Provider | undefined,
  opts: MaybeTitleOptions = {},
): Promise<string | undefined> {
  if (!provider || opts.disabled) return undefined
  const loaded = store.load(sessionId)
  const heuristic = titleFromMessages(loaded.messages)
  if (!heuristic || loaded.meta.title !== heuristic) return undefined
  if (!loaded.messages.some((m) => m.role === "assistant" && m.content)) return undefined

  const title = await generateTitle(provider, loaded.messages, {
    signal: opts.signal,
    params: opts.params,
    onUsage: (usage) => {
      try {
        store.addUsage?.(sessionId, usage, estimateCost(getModelInfo(opts.model ?? loaded.meta.model), usage))
      } catch {
        /* accounting must never fail a title */
      }
    },
  })
  if (!title || title === loaded.meta.title) return undefined
  store.rename?.(sessionId, title)
  opts.onRename?.(title)
  return title
}
