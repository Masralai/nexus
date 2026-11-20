import type { Transcript } from "./harness"

/**
 * Subset of a reference session export (v2.x) needed for the Tier 1 structural
 * comparison. Captured from the pinned reference build; extra fields are ignored.
 */
export interface SessionExport {
  info?: { title?: string }
  messages: SessionExportMessage[]
}

interface SessionExportPart {
  type: string
  text?: string
  name?: string
  state?: { status?: string; content?: Array<{ type?: string; text?: string }> }
}

interface SessionExportMessage {
  type: "user" | "assistant" | "system"
  /** User and system messages carry their text here; assistant messages use `content`. */
  text?: string
  content?: SessionExportPart[]
  finish?: string
  error?: { type?: string; message?: string }
}

export interface SessionExportMapOptions {
  /** Exit status of the reference run that produced the export, when known. */
  exitCode?: number
  /** Prompt characters the reference build sent, when the recorder measured them. */
  promptChars?: number
}

function textOf(content: Array<{ type?: string; text?: string }> | undefined): string {
  return (content ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim()
}

/**
 * Normalise a reference session export into the transcript shape the parity
 * harness compares.
 *
 * Reasoning parts are dropped: Nexus stores reasoning outside its durable part
 * stream (tokens only), so including them would compare unlike things. System
 * messages are dropped for the same reason — the system prompt is not a part.
 */
export function mapSessionExport(data: SessionExport, opts: SessionExportMapOptions = {}): Transcript {
  const events: Array<Record<string, unknown>> = []
  const parts: Array<{ type: string }> = []
  let steps = 0
  let failed = false
  let status = "unknown"

  for (const message of data.messages) {
    if (message.type === "system") continue
    if (message.type === "user") {
      parts.push({ type: "text" })
      continue
    }

    for (const part of message.content ?? []) {
      if (part.type === "text") {
        parts.push({ type: "text" })
        continue
      }
      if (part.type !== "tool") continue // reasoning and provider-specific parts have no Nexus part twin
      parts.push({ type: "tool_call" })
      events.push({ type: "toolCallStarted", name: part.name ?? "" })
      if (part.state?.status === "completed") {
        parts.push({ type: "tool_result" })
        events.push({ type: "toolResult", name: part.name ?? "" })
      } else if (part.state?.status === "error") {
        failed = true
        const detail = textOf(part.state.content) || "tool error"
        events.push({ type: "error", message: `${part.name ?? "tool"}: ${detail}` })
      }
    }

    if (message.error) {
      failed = true
      events.push({ type: "error", message: message.error.message ?? message.error.type ?? "provider error" })
    }
    // One step per assistant message that ended by asking for tools, matching
    // the Turn loop's step counter.
    if (message.finish === "tool-calls") steps++
    if (failed) status = "error"
    else if (message.finish) status = message.finish === "stop" ? "runComplete" : message.finish
  }

  events.push({ type: "runComplete", steps })
  return {
    events,
    parts,
    status,
    ...(opts.exitCode !== undefined ? { exitCode: opts.exitCode } : {}),
    ...(opts.promptChars !== undefined ? { promptChars: opts.promptChars } : {}),
  }
}
