import { expect, test } from "bun:test"
import { decide, type PermissionRules } from "./permission"
import { approxTokens, truncate, workingMemory } from "./context"
import type { Message } from "./types"

test("decide: default asks on bash, allows the rest", () => {
  const rules: PermissionRules = {}
  expect(decide(rules, "bash", "ls")).toBe("ask")
  expect(decide(rules, "read", "x")).toBe("allow")
})

test("decide: deny wins over allow, patterns beat tool lists", () => {
  const rules: PermissionRules = {
    allowTools: ["bash"],
    denyTools: ["read"],
    denyPatterns: [/rm -rf/],
  }
  expect(decide(rules, "bash", "rm -rf /")).toBe("deny")
  expect(decide(rules, "bash", "ls")).toBe("allow")
  expect(decide(rules, "read", "x")).toBe("deny")
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

test("workingMemory includes the task", () => {
  const msgs: Message[] = [{ role: "user", content: "fix the tests" }]
  expect(workingMemory(msgs)).toContain("[working-memory]")
  expect(workingMemory(msgs)).toContain("task: fix the tests")
})
test("workingMemory includes chat guidance", () => {
  const msgs: Message[] = [{ role: "user", content: "hi" }]
  expect(workingMemory(msgs)).toContain("Prefer a normal conversational reply")
  expect(workingMemory(msgs)).toContain("user declined")
})

test("workingMemory uses latest user message as task", () => {
  const msgs: Message[] = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi" },
    { role: "user", content: "why" },
  ]
  const wm = workingMemory(msgs)
  expect(wm).toContain("task: why")
  expect(wm).not.toContain("task: hello")
})
