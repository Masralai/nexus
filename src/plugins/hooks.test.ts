import { expect, test } from "bun:test"
import { PluginRegistry } from "./hooks"
import type { Tool } from "../engine/types"

const tool = (name: string): Tool => ({
  name,
  description: "",
  schema: {},
  async execute() {
    return { ok: true, output: name }
  },
})

test("plugins can wrap or hide tools", () => {
  const registry = new PluginRegistry().use({
    name: "hide-write",
    tool: (t) => (t.name === "write" ? undefined : { ...t, description: "wrapped" }),
  })
  const out = registry.tools([tool("read"), tool("write")], { cwd: "/tmp" })
  expect(out.map((t) => t.name)).toEqual(["read"])
  expect(out[0].description).toBe("wrapped")
})

test("plugins can register tools before wrapping", () => {
  const registry = new PluginRegistry()
    .use({ name: "add", registerTools: () => [tool("custom")] })
    .use({ name: "wrap", tool: (t) => ({ ...t, description: "wrapped" }) })
  const out = registry.tools([tool("read")], { cwd: "/tmp" })
  expect(out.map((t) => t.name)).toEqual(["read", "custom"])
  expect(out.every((t) => t.description === "wrapped")).toBe(true)
})

test("auth providers are exposed without replacing BYOK resolution", () => {
  const registry = new PluginRegistry()
    .use({ name: "a", auth: () => ({ apiKey: "first" }) })
    .use({ name: "b", auth: () => ({ apiKey: "second" }) })
  expect(registry.auth("openai")).toEqual({ apiKey: "second" })
})

test("plugin event failures never escape", () => {
  const registry = new PluginRegistry().use({
    name: "broken",
    event: () => {
      throw new Error("boom")
    },
  })
  expect(() => registry.emit({ type: "aborted" }, { cwd: "/tmp" })).not.toThrow()
})

test("permission observations are delivered and never throw", () => {
  const seen: { name: string; granted: boolean }[] = []
  const registry = new PluginRegistry()
    .use({ name: "good", permission: (req) => seen.push({ name: req.name, granted: req.granted }) })
    .use({ name: "bad", permission: () => { throw new Error("boom") } })
  expect(() => registry.permission({ name: "read", input: {}, granted: true }, { cwd: "/tmp" })).not.toThrow()
  expect(seen).toEqual([{ name: "read", granted: true }])
})

test("chatParams compose in registration order", () => {
  const registry = new PluginRegistry()
    .use({ name: "a", chatParams: (p) => ({ ...p, temperature: 0 }) })
    .use({ name: "b", chatParams: (p) => ({ ...p, top_p: 0.5 }) })
  expect(registry.chatParams({ model: "m" }, { cwd: "/tmp" })).toEqual({
    model: "m",
    temperature: 0,
    top_p: 0.5,
  })
})
