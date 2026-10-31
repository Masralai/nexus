import type { Message, SessionCounters, SessionMeta, SessionStatus } from "./types"

/** Stable on-disk shape for `nexus export` and `nexus import`. */
export interface ExportedMessage {
  /** Durable message id. Optional because legacy exports may omit it. */
  id?: string
  message: Message
}

export interface SessionExport {
  schemaVersion: 1
  session: SessionMeta
  status: SessionStatus
  counters: SessionCounters
  messages: ExportedMessage[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function messageOf(value: unknown): Message {
  if (!isObject(value)) throw new Error("message must be an object")
  if (value.role === "user") {
    if (typeof value.content !== "string") throw new Error("user message requires string content")
    return value as unknown as Message
  }
  if (value.role === "assistant") {
    if (value.content !== null && typeof value.content !== "string") {
      throw new Error("assistant message requires string or null content")
    }
    return value as unknown as Message
  }
  if (value.role === "tool") {
    if (typeof value.toolCallId !== "string" || typeof value.name !== "string") {
      throw new Error("tool message requires toolCallId and name")
    }
    return value as unknown as Message
  }
  throw new Error(`unknown message role: ${String(value.role)}`)
}

/** Validate an untrusted export before it touches the database. */
export function parseSessionExport(raw: unknown): SessionExport {
  if (!isObject(raw)) throw new Error("export must be an object")
  const source = isObject(raw.session) ? raw.session : isObject(raw.meta) ? raw.meta : undefined
  if (!source) throw new Error("export requires session metadata")
  if (typeof source.id !== "string" || !source.id) throw new Error("session.id must be a non-empty string")
  if (typeof source.cwd !== "string") throw new Error("session.cwd must be a string")
  if (typeof source.model !== "string") throw new Error("session.model must be a string")
  if (typeof source.provider !== "string") throw new Error("session.provider must be a string")
  if (typeof source.createdAt !== "string") throw new Error("session.createdAt must be a string")
  if (!Array.isArray(raw.messages)) throw new Error("export requires a messages array")
  const messages: ExportedMessage[] = raw.messages.map((entry) => {
    if (isObject(entry) && "message" in entry) {
      return {
        ...(typeof entry.id === "string" ? { id: entry.id } : {}),
        message: messageOf(entry.message),
      }
    }
    return { message: messageOf(entry) }
  })
  const status = raw.status
  if (
    status !== undefined &&
    status !== "running" &&
    status !== "done" &&
    status !== "aborted" &&
    status !== "error" &&
    status !== "limit"
  ) {
    throw new Error("session.status is invalid")
  }
  const counters = isObject(raw.counters) ? raw.counters : {}
  const number = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0)
  return {
    schemaVersion: 1,
    session: {
      id: source.id,
      cwd: source.cwd,
      model: source.model,
      provider: source.provider,
      createdAt: source.createdAt,
      ...(typeof source.parentId === "string" ? { parentId: source.parentId } : {}),
      ...(typeof source.forkBoundary === "string" ? { forkBoundary: source.forkBoundary } : {}),
      ...(typeof source.title === "string" ? { title: source.title } : {}),
    },
    status: (status as SessionStatus | undefined) ?? "done",
    counters: {
      inputTokens: number(counters.inputTokens),
      outputTokens: number(counters.outputTokens),
      reasoningTokens: number(counters.reasoningTokens),
      cacheReadTokens: number(counters.cacheReadTokens),
      cacheWriteTokens: number(counters.cacheWriteTokens),
      cost: number(counters.cost),
    },
    messages,
  }
}

function textPart(message: Message): string {
  if (message.role === "user") return message.content
  if (message.role === "assistant") return message.content ?? ""
  return message.result.output
}

/** Markdown export for humans; JSON remains the round-trip format. */
export function sessionToMarkdown(doc: SessionExport): string {
  const { session, counters } = doc
  const lines = [
    `# ${session.title || session.id}`,
    "",
    `- Session: \`${session.id}\``,
    `- Model: \`${session.model}\` (${session.provider})`,
    `- Working directory: \`${session.cwd}\``,
    `- Created: ${session.createdAt}`,
    `- Status: ${doc.status}`,
    `- Tokens: ${counters.inputTokens} in / ${counters.outputTokens} out / ${counters.reasoningTokens} reasoning`,
    `- Cache: ${counters.cacheReadTokens} read / ${counters.cacheWriteTokens} write`,
    `- Cost: $${counters.cost.toFixed(6)}`,
    "",
  ]
  for (const { id, message } of doc.messages) {
    const label =
      message.role === "tool"
        ? `tool ${message.name}`
        : message.role === "user" && message.synthetic === "compaction"
          ? "compaction"
          : message.role
    lines.push(`## ${label}${id ? ` (${id})` : ""}`, "")
    if (message.role === "assistant" && message.toolCalls?.length) {
      if (message.content) lines.push(message.content, "")
      for (const call of message.toolCalls) {
        lines.push("```json", JSON.stringify(call, null, 2), "```", "")
      }
    } else {
      lines.push(textPart(message), "")
    }
  }
  return lines.join("\n").trimEnd() + "\n"
}
