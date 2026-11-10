/**
 * Structural comparison for replayed agent transcripts. The producers are
 * intentionally external: the release harness feeds the same fixture to Nexus
 * and to the pinned opencode black box, then compares the two JSON transcripts.
 */

export interface Transcript {
  events: Array<Record<string, unknown>>
  /** Ordered Session part types, when the producer can export them. */
  parts?: Array<{ type?: string }>
  /** System + user prompt characters for the same fixture. */
  promptChars?: number
  exitCode?: number
  status?: string
}

export interface ParityReport {
  ok: boolean
  failures: string[]
  actual: TranscriptSummary
  reference: TranscriptSummary
  promptGrowthPct?: number
}

export interface TranscriptSummary {
  toolCalls: string[]
  permissions: string[]
  partTypes: string[]
  steps?: number
  status: string
  exitCode?: number
  errors: string[]
}

function partTypes(transcript: Transcript): string[] {
  if (transcript.parts) return transcript.parts.map((part) => part.type ?? "unknown")
  const out: string[] = []
  for (const event of transcript.events) {
    const type = String(event.type ?? "")
    if (type === "messageAdded") {
      const message = event.message as { role?: string } | undefined
      out.push(`message:${message?.role ?? "unknown"}`)
    } else if (type === "toolCallStarted") out.push("tool_call")
    else if (type === "toolResult") out.push("tool_result")
    else if (type === "permissionRequest") out.push("permission")
    else if (type === "questionRequest") out.push("question")
  }
  return out
}

function finalStatus(transcript: Transcript): string {
  if (transcript.status) return transcript.status
  for (let i = transcript.events.length - 1; i >= 0; i--) {
    const type = String(transcript.events[i]?.type ?? "")
    if (["runComplete", "aborted", "error", "stepLimit"].includes(type)) return type
  }
  return "unknown"
}

function summary(transcript: Transcript): TranscriptSummary {
  const events = transcript.events
  const last = (type: string): Record<string, unknown> | undefined => {
    for (let i = events.length - 1; i >= 0; i--) if (events[i]?.type === type) return events[i]
    return undefined
  }
  const complete = last("runComplete")
  const turn = last("turnComplete")
  const steps =
    typeof complete?.steps === "number"
      ? complete.steps
      : typeof turn?.step === "number"
        ? turn.step
        : undefined
  return {
    toolCalls: events.filter((event) => event.type === "toolCallStarted").map((event) => String(event.name ?? "")),
    permissions: events.filter((event) => event.type === "permissionRequest").map((event) => String(event.name ?? "")),
    partTypes: partTypes(transcript),
    steps,
    status: finalStatus(transcript),
    exitCode: transcript.exitCode,
    errors: events.filter((event) => event.type === "error").map((event) => String(event.message ?? "error")),
  }
}

function same(label: string, actual: unknown, reference: unknown, failures: string[]): void {
  if (JSON.stringify(actual) !== JSON.stringify(reference)) {
    failures.push(`${label}: actual=${JSON.stringify(actual)} reference=${JSON.stringify(reference)}`)
  }
}

export function compareTranscripts(
  actual: Transcript,
  reference: Transcript,
  opts: { maxPromptGrowthPct?: number } = {},
): ParityReport {
  const a = summary(actual)
  const b = summary(reference)
  const failures: string[] = []

  if (a.errors.length > 0) failures.push(`provider errors: ${a.errors.join("; ")}`)
  same("tool-call sequence", a.toolCalls, b.toolCalls, failures)
  same("step count", a.steps, b.steps, failures)
  same("part types and order", a.partTypes, b.partTypes, failures)
  same("permission sequence", a.permissions, b.permissions, failures)
  same("final status", a.status, b.status, failures)
  if (a.exitCode !== undefined || b.exitCode !== undefined) same("exit code", a.exitCode, b.exitCode, failures)

  let promptGrowthPct: number | undefined
  if (reference.promptChars !== undefined && reference.promptChars > 0 && actual.promptChars !== undefined) {
    promptGrowthPct = ((actual.promptChars - reference.promptChars) / reference.promptChars) * 100
    const max = opts.maxPromptGrowthPct ?? 5
    if (promptGrowthPct > max) {
      failures.push(`prompt size: ${promptGrowthPct.toFixed(2)}% larger (max ${max}%)`)
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    actual: a,
    reference: b,
    ...(promptGrowthPct !== undefined ? { promptGrowthPct } : {}),
  }
}
