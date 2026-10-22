import { expect, test } from "bun:test"
import { MockProvider } from "../providers/mock"
import { decide, type PermissionRules } from "./permission"
import {
  approxTokens,
  buildPrompt,
  maybeCompact,
  toolBudget,
  truncate,
  truncateTool,
} from "./context"
import type { Message } from "./types"

test("decide: default asks mutators, allows readonly in cwd", () => {
  const rules: PermissionRules = {}
  expect(decide(rules, "bash", "ls")).toBe("ask")
  expect(decide(rules, "write", "x")).toBe("ask")
  expect(decide(rules, "read", "x", { readonly: true })).toBe("allow")
})

test("decide: deny wins over allow, patterns beat tool lists", () => {
  const rules: PermissionRules = {
    allowTools: ["bash"],
    denyTools: ["read"],
    denyPatterns: [/rm -rf/],
  }
  expect(decide(rules, "bash", "rm -rf /")).toBe("deny")
  expect(decide(rules, "bash", "ls")).toBe("allow")
  expect(decide(rules, "read", "x", { readonly: true })).toBe("deny")
})

test("decide: askTools forces a prompt", () => {
  expect(decide({ askTools: ["edit"] }, "edit", "x")).toBe("ask")
})

test("truncate keeps short text, caps long text with marker", () => {
  expect(truncate("abc", 10)).toBe("abc")
  const out = truncate("a".repeat(100), 10)
  expect(out).toContain("[...truncated")
  expect(out.length).toBeLessThan(100)
})

test("approxTokens scales with content length", () => {
  expect(approxTokens({ role: "user", content: "hello world" })).toBe(3)
  expect(approxTokens({ role: "tool", toolCallId: "c", name: "t", result: { ok: true, output: "1234" } })).toBe(1)
})

test("tool budgets are per tool and bounded", () => {
  expect(toolBudget("read")).toBeGreaterThan(toolBudget("glob"))
  expect(toolBudget("unknown-tool")).toBe(toolBudget("default"))
  expect(toolBudget("read")).toBeGreaterThan(0)
})

test("buildPrompt returns the system channel separately and truncates tool output", () => {
  const msgs: Message[] = [
    { role: "user", content: "task" },
    {
      role: "tool",
      toolCallId: "c",
      name: "read",
      result: { ok: true, output: "x".repeat(50_000) },
    },
  ]
  const prompt = buildPrompt(msgs, "SYSTEM")
  expect(prompt.system).toBe("SYSTEM")
  expect(prompt.messages[0]).toEqual({ role: "user", content: "task" })
  const tool = prompt.messages[1] as Extract<Message, { role: "tool" }>
  expect(tool.result.output).toContain("[...truncated")
  expect(tool.result.output.length).toBeLessThan(50_000)
  // Stored messages are untouched.
  expect(msgs[1].role === "tool" && msgs[1].result.output.length).toBe(50_000)
})

test("truncateTool respects the named budget", () => {
  const out = truncateTool("glob", "y".repeat(20_000))
  expect(out).toContain("[...truncated")
  expect(out.length).toBeLessThan(toolBudget("read") * 4)
})

test("maybeCompact returns a new list and leaves the input unchanged", async () => {
  const messages: Message[] = Array.from({ length: 8 }, (_, i) => ({
    role: "user" as const,
    content: "x".repeat(200) + String(i),
  }))
  const snapshot = structuredClone(messages)
  const cheap = new MockProvider([{ content: "SUM" }])
  const out = await maybeCompact(messages, { provider: cheap, threshold: 0.1, keepRecent: 2, limit: 100 })
  expect(messages).toEqual(snapshot)
  expect(out).not.toBeNull()
  expect(out).not.toBe(messages)
  expect(out![0]).toEqual({ role: "user", content: "[prior context]\nSUM", synthetic: "compaction" })
  expect(out!.slice(1).map((m) => (m as { content: string }).content)).toEqual([
    "x".repeat(200) + "6",
    "x".repeat(200) + "7",
  ])
})

test("maybeCompact returns null under threshold and does not call the cheap provider", async () => {
  const messages: Message[] = [{ role: "user", content: "hi" }]
  const cheap = new MockProvider([{ content: "SUM" }])
  const out = await maybeCompact(messages, { provider: cheap, threshold: 0.8, keepRecent: 6, limit: 100_000 })
  expect(out).toBeNull()
  expect(cheap.lastPrompt).toEqual([])
  expect(messages).toEqual([{ role: "user", content: "hi" }])
})

test("maybeCompact declines when only the active request can be summarized", async () => {
  const messages: Message[] = [
    { role: "user", content: "x".repeat(500) },
    { role: "assistant", content: "a" },
    { role: "tool", toolCallId: "c1", name: "read", result: { ok: true, output: "r" } },
    { role: "assistant", content: "b" },
  ]
  const cheap = new MockProvider([{ content: "SUM" }])
  const out = await maybeCompact(messages, { provider: cheap, threshold: 0.1, keepRecent: 2, limit: 10 })
  expect(out).toBeNull()
  expect(cheap.lastPrompt).toEqual([])
})
