import { expect, test } from "bun:test"
import { MockProvider } from "../providers/mock"
import { decide, type PermissionRules } from "./permission"
import { approxTokens, assemblePrompt, maybeCompact, truncate, workingMemory } from "./context"
import type { Message } from "./types"
import type { Skill } from "../skills"

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

test("workingMemory plan mode adds read-only line", () => {
  const msgs: Message[] = [{ role: "user", content: "design auth" }]
  expect(workingMemory(msgs, "plan")).toContain("Mode: plan")
  expect(workingMemory(msgs, "build")).not.toContain("Mode: plan")
})

test("decide: plan denyTools blocks write/edit/bash", () => {
  const rules: PermissionRules = { denyTools: ["write", "edit", "bash"] }
  expect(decide(rules, "write", "x")).toBe("deny")
  expect(decide(rules, "edit", "x")).toBe("deny")
  expect(decide(rules, "bash", "ls")).toBe("deny")
  expect(decide(rules, "read", "x")).toBe("allow")
})

test("assemblePrompt prepends working memory and truncates tool output", () => {
  const msgs: Message[] = [
    { role: "user", content: "task" },
    {
      role: "tool",
      toolCallId: "c",
      name: "read",
      result: { ok: true, output: "x".repeat(5000) },
    },
  ]
  const prompt = assemblePrompt(msgs, "build")
  expect(prompt[0]).toEqual({ role: "user", content: expect.stringContaining("task: task") })
  const tool = prompt[2] as Extract<Message, { role: "tool" }>
  expect(tool.result.output).toContain("[...truncated")
  expect(msgs[1].role === "tool" && msgs[1].result.output.length).toBe(5000)
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
  expect(out![0]).toEqual({ role: "user", content: "[prior context]\nSUM" })
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

test("workingMemory includes active skills", () => {
  const skill: Skill = {
    id: "ponytail",
    name: "ponytail",
    description: "lazy",
    body: "Do less.",
    path: "/x",
  }
  const wm = workingMemory([{ role: "user", content: "hi" }], "build", [skill])
  expect(wm).toContain("[active-skills]")
  expect(wm).toContain("## Skill: ponytail")
  expect(wm).toContain("Do less.")
})
