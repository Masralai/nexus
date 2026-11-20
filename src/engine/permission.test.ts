import { expect, test } from "bun:test"
import { decide, gateToolCall, isOutsideCwd, isReadOnlyBash, pathForCall, reasonForCall } from "./permission"

test("decide: readonly in cwd allows; mutators ask", () => {
  const rules = {}
  expect(decide(rules, "read", "x", { readonly: true })).toBe("allow")
  expect(decide(rules, "list", "x", { readonly: true })).toBe("allow")
  expect(decide(rules, "write", "x")).toBe("ask")
  expect(decide(rules, "edit", "x")).toBe("ask")
  expect(decide(rules, "bash", "npm install")).toBe("ask")
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

test("decide: allows safe read-only bash in cwd by default", () => {
  expect(decide({}, "bash", "pwd", { cwd: "/proj" })).toBe("allow")
  expect(decide({}, "bash", "ls", { cwd: "/proj" })).toBe("allow")
  expect(decide({}, "bash", "ls src", { cwd: "/proj" })).toBe("allow")
  expect(decide({}, "bash", "cat README.md", { cwd: "/proj" })).toBe("allow")
  expect(decide({}, "bash", "git status", { cwd: "/proj" })).toBe("allow")
  expect(decide({}, "bash", "git diff -- src/a.ts", { cwd: "/proj" })).toBe("allow")
  expect(decide({}, "bash", "git blame src/a.ts", { cwd: "/proj" })).toBe("allow")
  expect(decide({}, "bash", "rg TODO src", { cwd: "/proj" })).toBe("allow")
})

test("decide: asks mutating, complex, or outside-cwd bash", () => {
  expect(decide({}, "bash", "rm -rf /", { cwd: "/proj" })).toBe("ask")
  expect(decide({}, "bash", "touch a", { cwd: "/proj" })).toBe("ask")
  expect(decide({}, "bash", "cat /etc/passwd", { cwd: "/proj" })).toBe("ask")
  expect(decide({}, "bash", "ls ../..", { cwd: "/proj" })).toBe("ask")
  expect(decide({}, "bash", "ls | wc -l", { cwd: "/proj" })).toBe("ask")
  expect(decide({}, "bash", "echo hi > out.txt", { cwd: "/proj" })).toBe("ask")
  expect(decide({}, "bash", "git checkout main", { cwd: "/proj" })).toBe("ask")
  expect(decide({}, "bash", "find . -delete", { cwd: "/proj" })).toBe("ask")
})

test("decide: explicit bash rules still override read-only default", () => {
  expect(decide({ denyTools: ["bash"] }, "bash", "pwd", { cwd: "/proj" })).toBe("deny")
  expect(decide({ askTools: ["bash"] }, "bash", "pwd", { cwd: "/proj" })).toBe("ask")
  expect(decide({ allowTools: ["bash"] }, "bash", "rm -rf /", { cwd: "/proj" })).toBe("allow")
  expect(decide({ denyPatterns: [/pwd/] }, "bash", "pwd", { cwd: "/proj" })).toBe("deny")
})

test("isReadOnlyBash basic cases", () => {
  expect(isReadOnlyBash("pwd", "/proj")).toBe(true)
  expect(isReadOnlyBash("cat src/a.ts", "/proj")).toBe(true)
  expect(isReadOnlyBash("cat /etc/passwd", "/proj")).toBe(false)
  expect(isReadOnlyBash("npm install", "/proj")).toBe(false)
})

test("gateToolCall allows read-only bash without asking", async () => {
  let asked = false
  const ok = await gateToolCall({
    rules: {},
    id: "1",
    name: "bash",
    input: { command: "pwd" },
    cwd: "/proj",
    onAsk: () => {
      asked = true
    },
    askPermission: async () => false,
  })
  expect(ok).toBe(true)
  expect(asked).toBe(false)
})
