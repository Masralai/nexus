import { expect, test } from "bun:test"
import { linesOf, type StreamBlock, screenRows, extractSelection } from "./present"
import { assistantStyledRows } from "./markdown"

// Seam: present linesOf for assistant markdown
test("linesOf strips bullet and bold markers for assistant", () => {
  const block: StreamBlock = { kind: "assistant", text: "*   **Model-agnostic:** Supports multiple AI providers" }
  const lines = linesOf(block, 80)
  expect(lines[0]).toBe("• Model-agnostic: Supports multiple AI providers")
  expect(lines[0].includes("*")).toBe(false)
  expect(lines[0].includes("**")).toBe(false)
})

test("linesOf heading stripped", () => {
  const block: StreamBlock = { kind: "assistant", text: "## Overview" }
  expect(linesOf(block, 80)[0]).toBe("Overview")
})

test("linesOf blockquote prefix", () => {
  const block: StreamBlock = { kind: "assistant", text: "> quoted text" }
  expect(linesOf(block, 80)[0]).toBe("▎ quoted text")
})

test("linesOf rule", () => {
  const block: StreamBlock = { kind: "assistant", text: "---" }
  const line = linesOf(block, 20)[0]!
  expect(line.includes("─")).toBe(true)
  expect(line.includes("-")).toBe(false)
})

test("linesOf inline code stripped", () => {
  const block: StreamBlock = { kind: "assistant", text: "Uses `plan` and `build` modes" }
  const line = linesOf(block, 80)[0]!
  expect(line).toBe("Uses plan and build modes")
  expect(line.includes("`")).toBe(false)
})

test("linesOf link expanded", () => {
  const block: StreamBlock = { kind: "assistant", text: "see [Nexus](https://example.com) now" }
  const line = linesOf(block, 80)[0]!
  expect(line).toBe("see Nexus (https://example.com) now")
  expect(line.includes("[")).toBe(false)
})

test("linesOf html stripped", () => {
  const block: StreamBlock = { kind: "assistant", text: '<div align="center">hello **world**</div>' }
  expect(linesOf(block, 80)[0]).toBe("hello world")
})

test("linesOf preserves user literal", () => {
  const block: StreamBlock = { kind: "user", text: "* **not rendered**" }
  expect(linesOf(block, 80)[0]).toBe("* **not rendered**")
})

test("linesOf preserves tool-result literal", () => {
  const block: StreamBlock = { kind: "tool-result", ok: true, preview: "* **literal**" }
  expect(linesOf(block, 80)[0]).toContain("* **literal**")
})

test("assistant wrapping indents continuation", () => {
  const text = "*   **Model-agnostic:** Supports multiple AI providers through a unified configuration"
  const block: StreamBlock = { kind: "assistant", text }
  const lines = linesOf(block, 30)
  expect(lines.length).toBeGreaterThan(1)
  expect(lines[0].startsWith("• ")).toBe(true)
  expect(lines[1].startsWith("  ")).toBe(true)
  for (const l of lines) expect(l.includes("**")).toBe(false)
})

test("assistantStyledRows heading segments are bold", () => {
  const rows = assistantStyledRows("## Overview", 80)
  expect(rows[0].isHeading).toBe(true)
  expect(rows[0].segments.some((s) => s.kind === "bold" && s.text === "Overview")).toBe(true)
})

test("assistantStyledRows bullet segments contain bold", () => {
  const rows = assistantStyledRows("*   **Model-agnostic:** Supports", 80)
  const first = rows[0]!
  // prefix "• " plus bold "Model-agnostic:" plus text
  expect(first.plain.startsWith("• ")).toBe(true)
  expect(first.segments.some((s) => s.kind === "bold" && s.text === "Model-agnostic:")).toBe(true)
})

test("assistantStyledRows code segment color", () => {
  const rows = assistantStyledRows("Uses `plan` mode", 80)
  expect(rows[0].segments.some((s) => s.kind === "code" && s.text === "plan")).toBe(true)
})

test("screenRows and extractSelection plain over markdown", () => {
  const blocks: StreamBlock[] = [{ kind: "assistant", text: "* item one\n* item two" }]
  const cols = 80
  const rows = screenRows(blocks, cols)
  // rows lines should be plain without markers
  expect(rows[0].line).toBe("• item one")
  expect(rows[1].line).toBe("• item two")
  const sel = extractSelection(rows, { row: 0, col: 2 }, { row: 0, col: 6 }, cols)
  expect(sel).toBe("item")
})

test("live-assistant same rendering as assistant", () => {
  const a: StreamBlock = { kind: "assistant", text: "**bold** text" }
  const b: StreamBlock = { kind: "live-assistant", text: "**bold** text" }
  expect(linesOf(a, 80)).toEqual(linesOf(b, 80))
})
