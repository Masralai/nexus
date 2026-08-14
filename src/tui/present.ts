import type { AgentMode } from "../engine/mode"
import type { Message } from "../engine/types"

export type StreamBlock =
  | { kind: "splash" }
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "fence"; text: string }
  | { kind: "tool-call"; name: string; input: string }
  | { kind: "tool-result"; ok: boolean; preview: string; error?: string }
  | { kind: "live-line"; text: string }
  | { kind: "live-assistant"; text: string }
  | { kind: "log"; text: string }
  | { kind: "error"; text: string }
  | { kind: "aborted" }

export type OverlayKind = "picker" | "line" | "permission" | null

export interface ChromeState {
  input: string
  cursor: number
  history: string[]
  historyIdx: number | null
  draft: string
  viewportOffset: number
  followTail: boolean
  slashIdx: number
}

export interface LiveTurnSnapshot {
  lines: string[]
  assistantOutput: string
  status: { used: number; limit: number; pct: number; steps: number; model: string }
  error?: string
  aborted: boolean
}

export interface PresentInput {
  messages: Message[]
  live: LiveTurnSnapshot
  sessionId: string
  mode: AgentMode
  skillNames: string[]
  connected: boolean
  busy: boolean
  overlay: OverlayKind
  chrome: ChromeState
  log: string[]
}

export interface HeaderView {
  session: string
  mode: AgentMode
  model: string
  skills: string[]
  ctxUsed: number
  ctxLimit: number
  ctxPct: number
  steps: number
  connected: boolean
}

export interface ComposerView {
  mode: AgentMode
  value: string
  cursor: number
  busy: boolean
  slashIdx: number
}

export interface ShellView {
  header: HeaderView
  stream: StreamBlock[]
  composer: ComposerView
  overlay: OverlayKind
  viewportOffset: number
  followTail: boolean
}

export function initialChrome(): ChromeState {
  return {
    input: "",
    cursor: 0,
    history: [],
    historyIdx: null,
    draft: "",
    viewportOffset: 0,
    followTail: true,
    slashIdx: 0,
  }
}

function shortInput(value: unknown): string {
  const s = JSON.stringify(value)
  return s.length > 80 ? `${s.slice(0, 80)}…` : s
}

function preview(text: string): string {
  return (text.split("\n")[0] ?? "").slice(0, 120)
}

function splitAssistant(text: string): StreamBlock[] {
  const blocks: StreamBlock[] = []
  const re = /```[^\n]*\n([\s\S]*?)```/g
  let last = 0
  for (const m of text.matchAll(re)) {
    const before = text.slice(last, m.index).trim()
    if (before) blocks.push({ kind: "assistant", text: before })
    const body = (m[1] ?? "").replace(/\n$/, "")
    blocks.push({ kind: "fence", text: body })
    last = (m.index ?? 0) + m[0].length
  }
  const after = text.slice(last).trim()
  if (after) blocks.push({ kind: "assistant", text: after })
  if (blocks.length === 0 && text) blocks.push({ kind: "assistant", text })
  return blocks
}

function liveLineToBlock(line: string, running: boolean): StreamBlock {
  if (line.startsWith("▶")) {
    return { kind: "live-line", text: running ? `${line} …` : line }
  }
  const tagged = /^\s+(ok|error) (.*)$/.exec(line)
  if (tagged) {
    const ok = tagged[1] === "ok"
    let preview = tagged[2] ?? ""
    let error: string | undefined
    const wrapped = /^(.*) \[([^\]]+)\]$/.exec(preview)
    if (wrapped) {
      preview = wrapped[1] ?? ""
      error = wrapped[2]
    }
    return { kind: "tool-result", ok, preview, ...(error ? { error } : {}) }
  }
  return { kind: "live-line", text: line }
}

function blocksFromMessages(messages: Message[]): StreamBlock[] {
  const blocks: StreamBlock[] = []
  for (const m of messages) {
    if (m.role === "user") {
      blocks.push({ kind: "user", text: m.content })
    } else if (m.role === "assistant") {
      if (m.content) blocks.push(...splitAssistant(m.content))
      for (const call of m.toolCalls ?? []) {
        blocks.push({ kind: "tool-call", name: call.name, input: shortInput(call.input) })
      }
    } else if (m.role === "tool") {
      blocks.push({
        kind: "tool-result",
        ok: m.result.ok,
        preview: preview(m.result.output),
        ...(m.result.error ? { error: m.result.error } : {}),
      })
    }
  }
  return blocks
}

export type ChromeEvent =
  | { type: "insert"; ch: string }
  | { type: "left" }
  | { type: "right" }
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "historyPrev" }
  | { type: "historyNext" }
  | { type: "pageUp"; page: number; contentLength: number; viewHeight: number }
  | { type: "pageDown"; page: number; contentLength: number; viewHeight: number }
  | { type: "slashPrev"; count: number }
  | { type: "slashNext"; count: number }
  | { type: "commitUser" }
  | { type: "clear" }

export function reduceChrome(state: ChromeState, ev: ChromeEvent): ChromeState {
  switch (ev.type) {
    case "insert": {
      const input = state.input.slice(0, state.cursor) + ev.ch + state.input.slice(state.cursor)
      return { ...state, input, cursor: state.cursor + ev.ch.length, slashIdx: 0 }
    }
    case "left":
      return { ...state, cursor: Math.max(0, state.cursor - 1) }
    case "right":
      return { ...state, cursor: Math.min(state.input.length, state.cursor + 1) }
    case "backspace": {
      if (state.cursor === 0) return state
      const input = state.input.slice(0, state.cursor - 1) + state.input.slice(state.cursor)
      return { ...state, input, cursor: state.cursor - 1, slashIdx: 0 }
    }
    case "delete": {
      const input = state.input.slice(0, state.cursor) + state.input.slice(state.cursor + 1)
      return { ...state, input, slashIdx: 0 }
    }
    case "commitUser": {
      const line = state.input.trim()
      if (!line) {
        return { ...state, input: "", cursor: 0, historyIdx: null, draft: "", slashIdx: 0 }
      }
      return {
        ...state,
        history: [...state.history, line],
        input: "",
        cursor: 0,
        historyIdx: null,
        draft: "",
        slashIdx: 0,
      }
    }
    case "clear":
      return { ...state, input: "", cursor: 0, historyIdx: null, draft: "", slashIdx: 0 }
    case "historyPrev": {
      if (state.history.length === 0) return state
      const historyIdx = state.historyIdx === null ? state.history.length - 1 : Math.max(0, state.historyIdx - 1)
      const draft = state.historyIdx === null ? state.input : state.draft
      const next = state.history[historyIdx] ?? ""
      return { ...state, draft, historyIdx, input: next, cursor: next.length }
    }
    case "historyNext": {
      if (state.historyIdx === null) return state
      if (state.historyIdx >= state.history.length - 1) {
        return { ...state, historyIdx: null, input: state.draft, cursor: state.draft.length }
      }
      const historyIdx = state.historyIdx + 1
      const next = state.history[historyIdx] ?? ""
      return { ...state, historyIdx, input: next, cursor: next.length }
    }
    case "pageUp": {
      if (ev.contentLength <= ev.viewHeight) return state
      const start = state.followTail
        ? Math.max(0, ev.contentLength - ev.viewHeight)
        : state.viewportOffset
      return { ...state, viewportOffset: Math.max(0, start - ev.page), followTail: false }
    }
    case "pageDown": {
      const start = state.followTail
        ? Math.max(0, ev.contentLength - ev.viewHeight)
        : state.viewportOffset
      const maxStart = Math.max(0, ev.contentLength - ev.viewHeight)
      const viewportOffset = Math.min(maxStart, start + ev.page)
      return { ...state, viewportOffset, followTail: viewportOffset >= maxStart }
    }
    case "slashNext":
      return ev.count <= 0 ? state : { ...state, slashIdx: (state.slashIdx + 1) % ev.count }
    case "slashPrev":
      return ev.count <= 0 ? state : { ...state, slashIdx: (state.slashIdx - 1 + ev.count) % ev.count }
    default:
      return state
  }
}

export function present(input: PresentInput): ShellView {
  const { live, chrome } = input
  const stream: StreamBlock[] =
    input.messages.length === 0 && !input.busy ? [{ kind: "splash" }] : blocksFromMessages(input.messages)
  if (input.busy) {
    for (let i = 0; i < live.lines.length; i++) {
      const line = live.lines[i] ?? ""
      const running = i === live.lines.length - 1 && line.startsWith("▶")
      stream.push(liveLineToBlock(line, running))
    }
    if (live.assistantOutput) stream.push(...splitAssistant(live.assistantOutput).map((b) =>
      b.kind === "assistant" ? ({ kind: "live-assistant" as const, text: b.text }) : b,
    ))
  }
  for (const line of input.log) stream.push({ kind: "log", text: line })
  if (live.error) stream.push({ kind: "error", text: live.error })
  if (live.aborted) stream.push({ kind: "aborted" })
  return {
    header: {
      session: input.sessionId.slice(0, 8),
      mode: input.mode,
      model: live.status.model,
      skills: input.skillNames,
      ctxUsed: live.status.used,
      ctxLimit: live.status.limit,
      ctxPct: live.status.pct,
      steps: live.status.steps,
      connected: input.connected,
    },
    stream,
    composer: {
      mode: input.mode,
      value: chrome.input,
      cursor: chrome.cursor,
      busy: input.busy,
      slashIdx: chrome.slashIdx,
    },
    overlay: input.overlay,
    viewportOffset: chrome.viewportOffset,
    followTail: chrome.followTail,
  }
}

const USER_GUTTER = 2
const FENCE_INDENT = 2

function wrapLines(text: string, width: number): string[] {
  const w = Math.max(1, width)
  const lines: string[] = []
  for (const para of text.split("\n")) {
    if (para.length === 0) {
      lines.push("")
      continue
    }
    for (let i = 0; i < para.length; i += w) lines.push(para.slice(i, i + w))
  }
  return lines.length > 0 ? lines : [""]
}

function linesOf(block: StreamBlock, cols: number): string[] {
  const inner = Math.max(1, cols - USER_GUTTER)
  switch (block.kind) {
    case "splash":
      return ["Nexus", "BYOK coding agent"]
    case "user":
      return wrapLines(block.text, inner)
    case "assistant":
    case "live-assistant":
    case "log":
    case "error":
    case "live-line":
      return wrapLines(block.text, Math.max(1, cols))
    case "fence":
      return wrapLines(block.text, Math.max(1, cols - FENCE_INDENT))
    case "tool-call":
      return wrapLines(`▶ ${block.name} ${block.input}`, Math.max(1, cols))
    case "tool-result": {
      const tag = block.ok ? "ok" : "error"
      const extra = block.error ? ` [${block.error}]` : ""
      return wrapLines(`  ${tag} ${block.preview}${extra}`, Math.max(1, cols))
    }
    case "aborted":
      return ["aborted"]
  }
}

function clipBlock(block: StreamBlock, sliced: string[]): StreamBlock {
  const text = sliced.join("\n")
  switch (block.kind) {
    case "splash":
      return { kind: "splash" }
    case "aborted":
      return { kind: "aborted" }
    case "user":
      return { kind: "user", text }
    case "assistant":
      return { kind: "assistant", text }
    case "live-assistant":
      return { kind: "live-assistant", text }
    case "fence":
      return { kind: "fence", text }
    case "log":
      return { kind: "log", text }
    case "error":
      return { kind: "error", text }
    case "live-line":
      return { kind: "live-line", text }
    case "tool-call":
      return { kind: "live-line", text }
    case "tool-result":
      return { ...block, preview: text }
  }
}

export function streamRows(blocks: StreamBlock[], cols: number): number {
  return blocks.reduce((n, b) => n + linesOf(b, cols).length, 0)
}

export function windowStream(
  blocks: StreamBlock[],
  opts: { cols: number; height: number; offset: number; followTail: boolean },
): StreamBlock[] {
  const height = Math.max(1, opts.height)
  const lined = blocks.map((block) => ({ block, lines: linesOf(block, opts.cols) }))
  const total = lined.reduce((n, x) => n + x.lines.length, 0)
  const start = opts.followTail ? Math.max(0, total - height) : Math.max(0, opts.offset)
  const end = start + height
  const out: StreamBlock[] = []
  let row = 0
  for (const { block, lines } of lined) {
    const from = Math.max(0, start - row)
    const to = Math.min(lines.length, end - row)
    row += lines.length
    if (to <= from) continue
    const sliced = lines.slice(from, to)
    out.push(from === 0 && to === lines.length ? block : clipBlock(block, sliced))
  }
  return out
}

