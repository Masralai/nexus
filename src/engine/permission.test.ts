import { expect, test } from "bun:test"
import { decide, gateToolCall, isOutsideCwd, pathForCall, reasonForCall } from "./permission"

test("decide: readonly in cwd allows; mutators ask", () => {
  const rules = {}
  expect(decide(rules, "read", "x", { readonly: true })).toBe("allow")
  expect(decide(rules, "list", "x", { readonly: true })).toBe("allow")
  expect(decide(rules, "write", "x")).toBe("ask")
  expect(decide(rules, "edit", "x")).toBe("ask")
  expect(decide(rules, "bash", "ls")).toBe("ask")
})

test("decide: outside-cwd readonly asks", () => {
  expect(decide({}, "read", "/etc/passwd", { readonly: true, outsideCwd: true })).toBe("ask")
})

test("decide: plan denyTools still wins", () => {
  const rules = { denyTools: ["write", "edit", "bash"] }
  expect(decide(rules, "write", "x")).toBe("deny")
  expect(decide(rules, "edit", "x")).toBe("deny")
  expect(decide(rules, "bash", "ls")).toBe("deny")
  expect(decide(rules, "read", "x", { readonly: true })).toBe("allow")
})

test("decide: deny wins over allow; allowTools beats default ask", () => {
  const rules = {
    allowTools: ["bash"],
    denyTools: ["read"],
    denyPatterns: [/rm -rf/],
  }
  expect(decide(rules, "bash", "rm -rf /")).toBe("deny")
  expect(decide(rules, "bash", "ls")).toBe("allow")
  expect(decide(rules, "read", "x", { readonly: true })).toBe("deny")
})

test("decide: askTools forces a prompt even for readonly", () => {
  expect(decide({ askTools: ["read"] }, "read", "x", { readonly: true })).toBe("ask")
})

test("pathForCall reads path; glob only when it looks like a path; never bash", () => {
  expect(pathForCall("read", { path: "src/a.ts" })).toBe("src/a.ts")
  expect(pathForCall("list", { path: "." })).toBe(".")
  expect(pathForCall("grep", { pattern: "x", path: "src" })).toBe("src")
  expect(pathForCall("glob", { pattern: "**/*.ts" })).toBeUndefined()
  expect(pathForCall("glob", { pattern: "/etc/**" })).toBe("/etc/**")
  expect(pathForCall("bash", { command: "ls", path: "nope" })).toBeUndefined()
})

test("isOutsideCwd detects escapes and home paths", () => {
  expect(isOutsideCwd("/proj", "src/a.ts")).toBe(false)
  expect(isOutsideCwd("/proj", ".")).toBe(false)
  expect(isOutsideCwd("/proj", "/proj/src")).toBe(false)
  expect(isOutsideCwd("/proj", "../etc")).toBe(true)
  expect(isOutsideCwd("/proj", "/etc/passwd")).toBe(true)
  expect(isOutsideCwd("/proj", "~/.ssh/id_rsa")).toBe(true)
})

test("gateToolCall allows readonly in cwd without asking", async () => {
  let asked = false
  const ok = await gateToolCall({
    rules: {},
    id: "1",
    name: "read",
    input: { path: "a.ts" },
    readonly: true,
    cwd: "/proj",
    onAsk: () => {
      asked = true
    },
    askPermission: async () => false,
  })
  expect(ok).toBe(true)
  expect(asked).toBe(false)
})

test("gateToolCall asks readonly when path leaves cwd", async () => {
  const asks: string[] = []
  const ok = await gateToolCall({
    rules: {},
    id: "1",
    name: "read",
    input: { path: "/etc/passwd" },
    reason: "read /etc/passwd",
    readonly: true,
    cwd: "/proj",
    onAsk: (r) => asks.push(r.reason),
    askPermission: async () => true,
  })
  expect(ok).toBe(true)
  expect(asks).toEqual(["read /etc/passwd"])
})

test("gateToolCall asks write then honors callback", async () => {
  const asks: string[] = []
  const ok = await gateToolCall({
    rules: {},
    id: "1",
    name: "write",
    input: { path: "a.ts", content: "x" },
    reason: "write a.ts",
    cwd: "/proj",
    onAsk: (r) => asks.push(r.reason),
    askPermission: async () => true,
  })
  expect(ok).toBe(true)
  expect(asks).toEqual(["write a.ts"])
})

test("reasonForCall prefers command/path", () => {
  expect(reasonForCall("bash", { command: "rm -rf /" })).toBe("rm -rf /")
  expect(reasonForCall("write", { path: "a.ts", content: "x" })).toBe("write a.ts")
  expect(reasonForCall("list", { path: "src" })).toBe("list src")
})
