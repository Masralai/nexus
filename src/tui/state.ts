import type { EngineEvent } from "../engine/types"

export interface PermissionRequest {
  id: string
  name: string
  input: unknown
  reason: string
}

export interface Status {
  used: number
  limit: number
  pct: number
  steps: number
  model: string
}

export interface TUIState {
  lines: string[]
  assistantOutput: string
  status: Status
  permission: PermissionRequest | null
  done: boolean
  aborted: boolean
  error?: string
}

export function initialTUIState(model: string): TUIState {
  return {
    lines: [],
    assistantOutput: "",
    status: { used: 0, limit: 0, pct: 0, steps: 0, model },
    permission: null,
    done: false,
    aborted: false,
  }
}

function shortInput(input: unknown): string {
  const s = JSON.stringify(input)
  return s.length > 80 ? `${s.slice(0, 80)}…` : s
}

function preview(text: string): string {
  return (text.split("\n")[0] ?? "").slice(0, 120)
}

export function reduceEvent(s: TUIState, ev: EngineEvent): TUIState {
  switch (ev.type) {
    case "tokenDelta":
      return { ...s, assistantOutput: s.assistantOutput + ev.delta }
    case "toolCallStarted":
      return { ...s, lines: [...s.lines, `▶ ${ev.name} ${shortInput(ev.input)}`] }
    case "toolResult": {
      const tag = ev.result.ok ? "ok" : "error"
      const line = `  ${tag} ${preview(ev.result.output)}${ev.result.error ? ` [${ev.result.error}]` : ""}`
      return { ...s, lines: [...s.lines, line] }
    }
    case "permissionRequest":
      return { ...s, permission: { id: ev.id, name: ev.name, input: ev.input, reason: ev.reason } }
    case "contextUpdate":
      return { ...s, status: { ...s.status, used: ev.used, limit: ev.limit, pct: ev.pct } }
    case "turnComplete":
      return s.assistantOutput ? { ...s, lines: [...s.lines, s.assistantOutput], assistantOutput: "" } : s
    case "runComplete":
      return {
        ...s,
        lines: s.assistantOutput ? [...s.lines, s.assistantOutput] : s.lines,
        assistantOutput: "",
        done: true,
        status: { ...s.status, steps: ev.steps },
      }
    case "error":
      return { ...s, done: true, error: ev.message }
    case "aborted":
      return { ...s, done: true, aborted: true }
  }
}

/** Clear live-turn chrome after a turn ends; keep status / error / aborted. */
export function settleTurnView(s: TUIState, ev: EngineEvent): TUIState {
  return {
    ...initialTUIState(s.status.model),
    status: ev.type === "runComplete" ? { ...s.status, steps: ev.steps } : s.status,
    error: ev.type === "error" ? ev.message : undefined,
    aborted: ev.type === "aborted",
    done: true,
  }
}
