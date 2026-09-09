import { expect, test } from "bun:test"
import { stripHtml, parseInline, renderInlinePlain, assistantPlainLines } from "./markdown"

test("stripHtml removes tags", () => {
  expect(stripHtml('<div align="center">hello</div>')).toBe("hello")
  expect(stripHtml('a<br> b <span>x</span>')).toBe("a b x")
  expect(stripHtml("plain")).toBe("plain")
})

test("parseInline bold and code", () => {
  const segs = parseInline("**Model-agnostic:** supports `plan`")
  expect(segs).toEqual([
    { kind: "bold", text: "Model-agnostic:" },
    { kind: "text", text: " supports " },
    { kind: "code", text: "plan" },
  ])
})

test("parseInline link", () => {
  const segs = parseInline("see [Nexus](https://example.com) now")
  // link label + url as separate segments for styling (label plain, url dim)
  expect(segs.some((s) => s.text === "Nexus")).toBe(true)
  expect(segs.some((s) => s.text.includes("https://example.com"))).toBe(true)
})

test("renderInlinePlain strips markers", () => {
  expect(renderInlinePlain("**bold** and `code`")).toBe("bold and code")
  expect(renderInlinePlain("[label](https://example.com)")).toBe("label (https://example.com)")
  expect(renderInlinePlain("*italic* and _italic2_")).toBe("italic and italic2")
})

test("assistantPlainLines bullet list", () => {
  const text = "*   **Model-agnostic:** Supports multiple AI providers"
  const lines = assistantPlainLines(text, 80)
  expect(lines[0]).toBe("• Model-agnostic: Supports multiple AI providers")
  expect(lines[0].includes("*")).toBe(false)
  expect(lines[0].includes("**")).toBe(false)
})

test("assistantPlainLines heading", () => {
  const lines = assistantPlainLines("## Overview\nSome paragraph", 80)
  expect(lines[0]).toBe("Overview")
  expect(lines[1]).toBe("Some paragraph")
  const withBlank = assistantPlainLines("## Overview\n\nSome paragraph", 80)
  expect(withBlank).toEqual(["Overview", "", "Some paragraph"])
})

test("assistantPlainLines blockquote and rule", () => {
  expect(assistantPlainLines("> quoted text", 80)[0]).toBe("▎ quoted text")
  const rule = assistantPlainLines("---", 20)[0]
  expect(rule.includes("─")).toBe(true)
})

test("assistantPlainLines ordered list", () => {
  const lines = assistantPlainLines("1. first\n2. second", 80)
  expect(lines[0]).toBe("1. first")
  expect(lines[1]).toBe("2. second")
})

test("assistantPlainLines html stripped inside markdown", () => {
  const lines = assistantPlainLines('<div align="center">hello **world**</div>', 80)
  expect(lines[0]).toBe("hello world")
})

test("assistantPlainLines preserves empty lines and fences are not here", () => {
  const lines = assistantPlainLines("para one\n\npara two", 80)
  expect(lines).toEqual(["para one", "", "para two"])
})

test("assistantPlainLines wrapping with indent", () => {
  const text = "*   **Model-agnostic:** Supports multiple AI providers through a unified configuration"
  const lines = assistantPlainLines(text, 30)
  // first line has bullet, second line is indented continuation
  expect(lines[0].startsWith("• ")).toBe(true)
  expect(lines.length).toBeGreaterThan(1)
  expect(lines[1].startsWith("  ")).toBe(true)
  // no markdown markers in wrapped lines
  for (const l of lines) expect(l.includes("**")).toBe(false)
})
