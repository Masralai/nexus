import { expect, test } from "bun:test"
import { advertiseTools, modePolicy } from "./mode"
import { gateToolCall, reasonForCall } from "./permission"
import type { Tool } from "./types"

test("modePolicy plan denies mutators and adds guidance", () => {
  const p = modePolicy("plan")
  expect(p.rules.denyTools).toEqual(["write", "edit", "bash"])
  expect(p.guidance).toContain("Mode: plan")
  expect(modePolicy("build").rules.denyTools ?? []).toEqual([])
})

test("advertiseTools hides mutators in plan", () => {
  const tools: Tool[] = [
    { name: "read", description: "", schema: {}, readonly: true, execute: async () => ({ ok: true, output: "" }) },
    { name: "write", description: "", schema: {}, readonly: false, execute: async () => ({ ok: true, output: "" }) },
  ]
  const reg = new Map(tools.map((t) => [t.name, t]))
  expect(advertiseTools(reg, "plan").map((t) => t.name)).toEqual(["read"])
  expect(advertiseTools(reg, "build").map((t) => t.name).sort()).toEqual(["read", "write"])
})

test("gateToolCall asks then honors callback", async () => {
  const asks: string[] = []
  const ok = await gateToolCall({
    rules: {},
    id: "1",
    name: "bash",
    input: { command: "ls" },
    reason: "ls",
    onAsk: (r) => asks.push(r.reason),
    askPermission: async () => true,
  })
  expect(ok).toBe(true)
  expect(asks).toEqual(["ls"])
})

test("gateToolCall denies without asking", async () => {
  let asked = false
  const ok = await gateToolCall({
    rules: { denyTools: ["write"] },
    id: "1",
    name: "write",
    input: { path: "x" },
    onAsk: () => {
      asked = true
    },
    askPermission: async () => true,
  })
  expect(ok).toBe(false)
  expect(asked).toBe(false)
})

test("reasonForCall prefers command/path", () => {
  expect(reasonForCall("bash", { command: "rm -rf /" })).toBe("rm -rf /")
  expect(reasonForCall("write", { path: "a.ts", content: "x" })).toBe("write a.ts")
})
