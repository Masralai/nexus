import type { Message } from "./types"
import type { Provider } from "../providers/types"

export function shouldCompact(pct: number, threshold = 0.8): boolean {
  return pct >= threshold
}

export async function summarize(
  cheap: Provider,
  head: Message[],
  params?: Record<string, unknown>,
): Promise<string> {
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
  for await (const ev of cheap.stream([{ role: "user", content: prompt }], [], { params })) {
    if (ev.type === "token") out += ev.text
    else if (ev.type === "done" && ev.content) out = ev.content
  }
  return out || "(empty summary)"
}

function lastActiveUser(messages: readonly Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "user" && m.synthetic !== "compaction") return i
  }
  return -1
}

function assistantOwning(messages: readonly Message[], id: string, before: number, floor: number): number {
  for (let i = before; i >= floor; i--) {
    const m = messages[i]
    if (m.role === "assistant" && m.toolCalls?.some((c) => c.id === id)) return i
  }
  return -1
}

/**
 * Choose a tail boundary that never orphans a tool result.
 *
 * Rules:
 * - Keep at least `keepRecent` messages when possible.
 * - Keep the active (last non-synthetic) user request in the tail.
 * - If the tail would start with a tool result, include the assistant call that produced it.
 * - If an assistant tool call is in the head while its result is in the tail, move the boundary back.
 */
export function safeSplit(messages: readonly Message[], keepRecent: number): number {
  const n = messages.length
  if (n <= keepRecent) return 0
  let split = Math.max(0, n - keepRecent)

  const active = lastActiveUser(messages)
  if (active >= 0 && active < split) split = active

  while (split > 0 && messages[split].role === "tool") {
    const tool = messages[split] as Extract<Message, { role: "tool" }>
    const owner = assistantOwning(messages, tool.toolCallId, split - 1, 0)
    if (owner < 0) break
    split = owner
  }

  // A later tool result may still point at an assistant call left in the head.
  for (let i = split; i < n; i++) {
    const m = messages[i]
    if (m.role !== "tool") continue
    const owner = assistantOwning(messages, m.toolCallId, i - 1, split)
    if (owner >= 0) continue
    const inHead = assistantOwning(messages, m.toolCallId, split - 1, 0)
    if (inHead >= 0) split = inHead
  }

  // Never start the tail with a tool result.
  while (split > 0 && messages[split].role === "tool") split--
  return Math.max(0, split)
}

export async function compactMessages(
  messages: readonly Message[],
  cheap: Provider,
  keepRecent = 6,
  params?: Record<string, unknown>,
): Promise<Message[]> {
  if (messages.length <= keepRecent) return messages.slice()
  const split = safeSplit(messages, keepRecent)
  if (split === 0) return messages.slice()
  const head = messages.slice(0, split)
  const tail = messages.slice(split)
  if (head.length === 0) return messages.slice()
  const summary = await summarize(cheap, head, params)
  return [
    { role: "user", content: `[prior context]\n${summary}`, synthetic: "compaction" },
    ...tail,
  ]
}
