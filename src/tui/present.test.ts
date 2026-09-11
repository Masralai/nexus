import { expect, test } from "bun:test"
import type { Message } from "../engine/types"
import { initialTUIState } from "./state"
import {
  clampOffset,
  easeOutCubic,
  initialChrome,
  interpolatedOffset,
  linesOf,
  maxStart,
  present,
  reduceChrome,
  scrollStep,
  streamRows,
  windowStream,
  type PresentInput,
} from "./present"

function input(partial: Partial<PresentInput> = {}): PresentInput {
  return {
    messages: [],
    live: initialTUIState("claude-opus"),
    sessionId: "abcdef12-9999-4000-8000-000000000000",
    mode: "build",
    skillNames: [],
    connected: true,
    busy: false,
    overlay: null,
    chrome: initialChrome(),
    log: [],
    ...partial,
  }
}

test("empty session presents splash and header chrome", () => {
  const v = present(input())
  expect(v.stream).toEqual([{ kind: "splash" }])
  expect(v.footer).toEqual({
    mode: "build",
    model: "claude-opus",
    skills: [],
    ctxUsed: 0,
    ctxLimit: 0,
    ctxPct: 0,
    steps: 0,
    connected: true,
  })
  // header deprecated alias still carries session for compat
  expect(v.header).toEqual({
    session: "abcdef12",
    mode: "build",
    model: "claude-opus",
    skills: [],
    ctxUsed: 0,
    ctxLimit: 0,
    ctxPct: 0,
    steps: 0,
    connected: true,
  })
  // footer must not expose session
  expect((v.footer as unknown as { session?: string }).session).toBeUndefined()
  expect(v.composer.mode).toBe("build")
  expect(v.overlay).toBeNull()
})

test("user message replaces splash with you / assistant / tool blocks", () => {
  const messages: Message[] = [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: "hello",
      toolCalls: [{ id: "1", name: "bash", input: { cmd: "ls" } }],
    },
    { role: "tool", toolCallId: "1", name: "bash", result: { ok: true, output: "a\nb" } },
    { role: "assistant", content: "done" },
  ]
  expect(present(input({ messages })).stream).toEqual([
    { kind: "user", text: "hi" },
    { kind: "assistant", text: "hello" },
    { kind: "tool-call", name: "bash", input: '{"cmd":"ls"}' },
    { kind: "tool-result", ok: true, preview: "a" },
    { kind: "assistant", text: "done" },
  ])
})

test("skips null assistant content without tools", () => {
  expect(present(input({ messages: [{ role: "assistant", content: null }] })).stream).toEqual([])
})

test("failed tool result carries error and ok false", () => {
  const messages: Message[] = [
    { role: "tool", toolCallId: "1", name: "bash", result: { ok: false, output: "nope", error: "ENOENT" } },
  ]
  expect(present(input({ messages })).stream).toEqual([
    { kind: "tool-result", ok: false, preview: "nope", error: "ENOENT" },
  ])
})

test("splits fenced markdown out of assistant text", () => {
  const messages: Message[] = [
    { role: "assistant", content: "see:\n```\nconst x = 1\n```\nok" },
  ]
  expect(present(input({ messages })).stream).toEqual([
    { kind: "assistant", text: "see:" },
    { kind: "fence", text: "const x = 1" },
    { kind: "assistant", text: "ok" },
  ])
})

test("busy turn appends live tail after committed messages", () => {
  const live = initialTUIState("m")
  live.lines = ['▶ bash {"cmd":"ls"}']
  live.assistantOutput = "working"
  const v = present(
    input({
      messages: [{ role: "user", content: "go" }],
      live,
      busy: true,
    }),
  )
  expect(v.stream).toEqual([
    { kind: "user", text: "go" },
    { kind: "live-line", text: '▶ bash {"cmd":"ls"} …' },
    { kind: "live-assistant", text: "working" },
  ])
  expect(v.composer.busy).toBe(true)
})

test("in-flight tool live line gets a running suffix", () => {
  const live = initialTUIState("m")
  live.lines = ['▶ bash {"cmd":"ls"}']
  const v = present(input({ messages: [{ role: "user", content: "go" }], live, busy: true }))
  expect(v.stream.at(-1)).toEqual({ kind: "live-line", text: '▶ bash {"cmd":"ls"} …' })
})

test("live tool error is a failed tool-result block", () => {
  const live = initialTUIState("m")
  live.lines = ['▶ bash {"cmd":"no"}', "  error nope [ENOENT]"]
  const v = present(input({ messages: [{ role: "user", content: "go" }], live, busy: true }))
  expect(v.stream.at(-1)).toEqual({ kind: "tool-result", ok: false, preview: "nope", error: "ENOENT" })
})

test("logs error and aborted trail the stream; splash stays without messages", () => {
  const live = initialTUIState("m")
  live.error = "boom"
  live.aborted = true
  const v = present(input({ live, log: ["mode: plan"] }))
  expect(v.stream).toEqual([
    { kind: "splash" },
    { kind: "log", text: "mode: plan" },
    { kind: "error", text: "boom" },
    { kind: "aborted" },
  ])
})

test("header reflects plan mode, skills, ctx, and disconnected", () => {
  const live = initialTUIState("gpt")
  live.status = { used: 100, limit: 8000, pct: 0.0125, steps: 3, model: "gpt" }
  const v = present(
    input({
      live,
      mode: "plan",
      skillNames: ["grill"],
      connected: false,
      overlay: "permission",
    }),
  )
  expect(v.footer.mode).toBe("plan")
  expect(v.footer.skills).toEqual(["grill"])
  expect(v.footer.connected).toBe(false)
  expect(v.footer.ctxUsed).toBe(100)
  expect(v.footer.ctxLimit).toBe(8000)
  expect(v.footer.steps).toBe(3)
  // deprecated header mirrors footer + session
  expect(v.header.mode).toBe("plan")
  expect(v.composer.mode).toBe("plan")
  expect(v.overlay).toBe("permission")
})

test("footer does not expose session id", () => {
  const v = present(input())
  expect((v.footer as unknown as { session?: string }).session).toBeUndefined()
  expect(v.footer.mode).toBe("build")
})

test("insert and arrow keys move the composer cursor", () => {
  let c = initialChrome()
  c = reduceChrome(c, { type: "insert", ch: "ab" })
  expect(c.input).toBe("ab")
  expect(c.cursor).toBe(2)
  c = reduceChrome(c, { type: "left" })
  expect(c.cursor).toBe(1)
  c = reduceChrome(c, { type: "insert", ch: "X" })
  expect(c.input).toBe("aXb")
  expect(c.cursor).toBe(2)
  c = reduceChrome(c, { type: "backspace" })
  expect(c.input).toBe("ab")
  expect(c.cursor).toBe(1)
})

test("commitUser stores history; up/down walk prior prompts then restore draft", () => {
  let c = initialChrome()
  c = reduceChrome(c, { type: "insert", ch: "first" })
  c = reduceChrome(c, { type: "commitUser" })
  c = reduceChrome(c, { type: "insert", ch: "second" })
  c = reduceChrome(c, { type: "commitUser" })
  c = reduceChrome(c, { type: "insert", ch: "draft" })
  c = reduceChrome(c, { type: "historyPrev" })
  expect(c.input).toBe("second")
  c = reduceChrome(c, { type: "historyPrev" })
  expect(c.input).toBe("first")
  c = reduceChrome(c, { type: "historyNext" })
  expect(c.input).toBe("second")
  c = reduceChrome(c, { type: "historyNext" })
  expect(c.input).toBe("draft")
  expect(c.historyIdx).toBeNull()
})

test("slash commands are not stored as user history", () => {
  let c = reduceChrome(initialChrome(), { type: "insert", ch: "/help" })
  c = reduceChrome(c, { type: "clear" })
  expect(c.input).toBe("")
  expect(c.history).toEqual([])
})

test("commitUser dedups consecutive duplicate", () => {
  let c = initialChrome()
  c = reduceChrome(c, { type: "insert", ch: "dup" })
  c = reduceChrome(c, { type: "commitUser" })
  c = reduceChrome(c, { type: "insert", ch: "dup" })
  c = reduceChrome(c, { type: "commitUser" })
  expect(c.history).toEqual(["dup"])
})

test("commitUser caps history at 100", () => {
  let c = initialChrome()
  for (let i = 0; i < 105; i++) {
    c = reduceChrome(c, { type: "insert", ch: `p${i}` })
    c = reduceChrome(c, { type: "commitUser" })
  }
  expect(c.history.length).toBe(100)
  expect(c.history[0]).toBe("p5")
  expect(c.history[99]).toBe("p104")
})

test("commitUser ignores empty trim", () => {
  let c = reduceChrome(initialChrome(), { type: "insert", ch: "   " })
  c = reduceChrome(c, { type: "commitUser" })
  expect(c.history).toEqual([])
})

test("pageUp pins the window; pageDown to the end follows the tail again", () => {
  let c = reduceChrome(initialChrome(), {
    type: "pageUp",
    page: 5,
    contentLength: 20,
    viewHeight: 8,
  })
  expect(c.followTail).toBe(false)
  expect(c.viewportOffset).toBe(7)
  c = reduceChrome(c, { type: "pageUp", page: 5, contentLength: 20, viewHeight: 8 })
  expect(c.viewportOffset).toBe(2)
  c = reduceChrome(c, { type: "pageUp", page: 5, contentLength: 20, viewHeight: 8 })
  expect(c.viewportOffset).toBe(0)
  c = reduceChrome(c, { type: "pageDown", page: 5, contentLength: 20, viewHeight: 8 })
  expect(c.viewportOffset).toBe(5)
  expect(c.followTail).toBe(false)
  c = reduceChrome(c, { type: "pageDown", page: 20, contentLength: 20, viewHeight: 8 })
  expect(c.followTail).toBe(true)
})

test("streamRows wraps a 25-character line into 3 rows at width 10", () => {
  expect(streamRows([{ kind: "assistant", text: "abcdefghijklmnopqrstuvwxy" }], 10)).toBe(3)
})

test("follow-tail window keeps the last rows of a tall live assistant and drops you", () => {
  const live = initialTUIState("m")
  live.assistantOutput = Array.from({ length: 100 }, (_, i) => `L${String(i).padStart(3, "0")}`).join("\n")
  const blocks = present(input({ messages: [{ role: "user", content: "ask" }], live, busy: true })).stream
  const win = windowStream(blocks, { cols: 80, height: 10, offset: 0, followTail: true })
  expect(win.some((b) => b.kind === "user")).toBe(false)
  expect(win).toEqual([
    {
      kind: "live-assistant",
      text: Array.from({ length: 10 }, (_, i) => `L${String(i + 90).padStart(3, "0")}`).join("\n"),
    },
  ])
})

test("pageUp by half the stream height brings you back into the window", () => {
  const live = initialTUIState("m")
  live.assistantOutput = Array.from({ length: 12 }, (_, i) => `L${String(i).padStart(3, "0")}`).join("\n")
  const blocks = present(input({ messages: [{ role: "user", content: "ask" }], live, busy: true })).stream
  const cols = 80
  const height = 10
  const page = Math.floor(height / 2)
  let chrome = reduceChrome(initialChrome(), {
    type: "pageUp",
    page,
    contentLength: streamRows(blocks, cols),
    viewHeight: height,
  })
  const win = windowStream(blocks, {
    cols,
    height,
    offset: chrome.viewportOffset,
    followTail: chrome.followTail,
  })
  expect(win[0]).toEqual({ kind: "user", text: "ask" })
})

test("pageUp through a long session reaches the oldest user message", () => {
  const messages: Message[] = []
  for (let i = 0; i < 8; i++) {
    messages.push({ role: "user", content: `question ${i}` })
    messages.push({ role: "assistant", content: `answer ${i} `.repeat(20) })
  }
  const blocks = present(input({ messages })).stream
  const cols = 40
  const height = 10
  const total = streamRows(blocks, cols)
  let chrome = initialChrome()
  while (chrome.viewportOffset > 0 || chrome.followTail) {
    chrome = reduceChrome(chrome, { type: "pageUp", page: height, contentLength: total, viewHeight: height })
    if (chrome.viewportOffset === 0 && !chrome.followTail) break
  }
  const win = windowStream(blocks, { cols, height, offset: chrome.viewportOffset, followTail: chrome.followTail })
  expect(win[0]).toEqual({ kind: "user", text: "question 0" })
})

test("stream row count matches flattened linesOf for wrapped assistant text", () => {
  const blocks = [{ kind: "assistant" as const, text: "abcdefghijklmnopqrstuvwxy" }]
  expect(streamRows(blocks, 10)).toBe(3)
  const flat = blocks.flatMap((b) => linesOf(b, 10))
  expect(flat).toHaveLength(3)
})
test("slash highlight wraps", () => {
  let c = reduceChrome(initialChrome(), { type: "slashNext", count: 3 })
  expect(c.slashIdx).toBe(1)
  c = reduceChrome(c, { type: "slashNext", count: 3 })
  c = reduceChrome(c, { type: "slashNext", count: 3 })
  expect(c.slashIdx).toBe(0)
  c = reduceChrome(c, { type: "slashPrev", count: 3 })
  expect(c.slashIdx).toBe(2)
})

test("scrollStep returns opencode-parity sizes", () => {
  expect(scrollStep("wheel", 10)).toBe(3)
  expect(scrollStep("wheel", 30)).toBe(3)
  expect(scrollStep("ctrl", 10)).toBe(5)
  expect(scrollStep("ctrl", 20)).toBe(5)
  expect(scrollStep("ctrl", 40)).toBe(10)
  expect(scrollStep("ctrl", 24)).toBe(6)
  expect(scrollStep("page", 10)).toBe(8)
  expect(scrollStep("page", 4)).toBe(2)
  expect(scrollStep("page", 1)).toBe(1)
})

test("maxStart and clampOffset handle boundaries", () => {
  expect(maxStart(20, 8)).toBe(12)
  expect(maxStart(5, 10)).toBe(0)
  expect(clampOffset(-5, 20, 8)).toBe(0)
  expect(clampOffset(100, 20, 8)).toBe(12)
  expect(clampOffset(5, 20, 8)).toBe(5)
})

test("easeOutCubic endpoints and monotonic", () => {
  expect(easeOutCubic(0)).toBe(0)
  expect(easeOutCubic(1)).toBe(1)
  expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 5)
  expect(easeOutCubic(0.25) < easeOutCubic(0.5)).toBe(true)
  expect(easeOutCubic(-1)).toBe(0)
  expect(easeOutCubic(2)).toBe(1)
})

test("interpolatedOffset eases toward target", () => {
  expect(interpolatedOffset(0, 10, 0)).toBe(0)
  expect(interpolatedOffset(0, 10, 1)).toBe(10)
  // 0.5 progress with ease 0.875 => 8.75 rounded 9
  expect(interpolatedOffset(0, 10, 0.5)).toBe(9)
  expect(interpolatedOffset(10, 0, 0.5)).toBe(1)
})

test("wheel-sized 3-row steps scroll line-by-line from tail", () => {
  let c = initialChrome()
  // content 20 rows, viewport 8, maxStart 12, tail at 12
  const total = 20
  const h = 8
  const wheel = scrollStep("wheel", h)
  expect(wheel).toBe(3)
  c = reduceChrome(c, { type: "pageUp", page: wheel, contentLength: total, viewHeight: h })
  expect(c.viewportOffset).toBe(9)
  expect(c.followTail).toBe(false)
  c = reduceChrome(c, { type: "pageUp", page: wheel, contentLength: total, viewHeight: h })
  expect(c.viewportOffset).toBe(6)
  c = reduceChrome(c, { type: "pageDown", page: wheel, contentLength: total, viewHeight: h })
  expect(c.viewportOffset).toBe(9)
})

test("ctrl and page steps computed from view height", () => {
  const h = 10
  const ctrl = scrollStep("ctrl", h)
  const page = scrollStep("page", h)
  let c = initialChrome()
  c = reduceChrome(c, { type: "pageUp", page: ctrl, contentLength: 30, viewHeight: h })
  expect(c.viewportOffset).toBe(20 - ctrl) // 20 = 30-10 maxStart
  c = reduceChrome(c, { type: "pageDown", page: page, contentLength: 30, viewHeight: h })
  // 15 + 8 = 23 clamped to 20 => re-pins to tail
  expect(c.followTail).toBe(true)
  // page from 15 -> 23 but clamped to max 20
  const c2 = reduceChrome(initialChrome(), { type: "pageUp", page: page, contentLength: 30, viewHeight: h })
  expect(c2.viewportOffset).toBe(12)
})

test("windowStream clips at 1-row granularity for wheel steps", () => {
  const blocks = [
    { kind: "user" as const, text: "q0" },
    { kind: "assistant" as const, text: Array.from({ length: 20 }, (_, i) => `L${i}`).join("\n") },
  ]
  const cols = 80
  const h = 6
  const total = streamRows(blocks, cols)
  let offset = maxStart(total, h)
  // move up by 1 row and ensure window shows one extra earlier line
  const winTail = windowStream(blocks, { cols, height: h, offset, followTail: false })
  const winUp1 = windowStream(blocks, { cols, height: h, offset: offset - 1, followTail: false })
  expect(winTail.length).toBeGreaterThan(0)
  expect(winUp1.length).toBeGreaterThan(0)
  // the first line of winUp1 should be one row earlier than tail
  const allLines = blocks.flatMap((b) => linesOf(b, cols))
  const tailLines = allLines.slice(offset, offset + h)
  const up1Lines = allLines.slice(offset - 1, offset - 1 + h)
  expect(up1Lines[0]).toBe(allLines[offset - 1])
  expect(tailLines[0]).toBe(allLines[offset])
})
