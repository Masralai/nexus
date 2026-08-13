import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Anthropic, toAnthropicMessages } from "./anthropic"
import { OpenAICompatible, toChatMessages } from "./openai-compatible"
import type { ProviderEvent } from "./types"
import type { Message, ToolDefinition } from "../engine/types"

const root = join(import.meta.dir, "../../fixtures/providers")

function fixture(...parts: string[]): string {
  return readFileSync(join(root, ...parts), "utf8")
}

function fakeFetch(sse: string, status = 200): typeof fetch {
  return (async () => new Response(sse, { status })) as unknown as typeof fetch
}

async function collect(iter: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const evts: ProviderEvent[] = []
  for await (const e of iter) evts.push(e)
  return evts
}

const emptyTools: ToolDefinition[] = []

test("openai: streams text tokens then done", async () => {
  const p = new OpenAICompatible({
    apiKey: "k",
    model: "m",
    contextWindow: 8000,
    fetchImpl: fakeFetch(fixture("openai-compatible", "text-stream.sse")),
  })
  expect(await collect(p.stream([{ role: "user", content: "hi" }], emptyTools, {}))).toEqual([
    { type: "token", text: "Hel" },
    { type: "token", text: "lo" },
    { type: "done", content: "Hello" },
  ])
})

test("openai: aggregates streamed tool calls", async () => {
  const p = new OpenAICompatible({
    apiKey: "k",
    model: "m",
    contextWindow: 8000,
    fetchImpl: fakeFetch(fixture("openai-compatible", "tool-calls.sse")),
  })
  expect(await collect(p.stream([], emptyTools, {}))).toEqual([
    { type: "toolCall", id: "c1", name: "read", input: { path: "a.txt" } },
    { type: "done", content: null },
  ])
})

test("openai: surfaces HTTP errors", async () => {
  const p = new OpenAICompatible({ apiKey: "k", model: "m", contextWindow: 8000, fetchImpl: fakeFetch("nope", 401) })
  await expect(collect(p.stream([], emptyTools, {}))).rejects.toThrow(/HTTP 401/)
})

test("openai: toChatMessages is lossless for canonical messages", () => {
  const msgs: Message[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: null, toolCalls: [{ id: "c1", name: "read", input: { path: "x" } }] },
    { role: "tool", toolCallId: "c1", name: "read", result: { ok: true, output: "xx" } },
  ]
  expect(toChatMessages(msgs)).toEqual([
    { role: "user", content: "hi" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: '{"path":"x"}' } }] },
    { role: "tool", tool_call_id: "c1", content: "xx" },
  ])
})

test("anthropic: streams text tokens then done", async () => {
  const p = new Anthropic({
    apiKey: "k",
    model: "m",
    contextWindow: 200000,
    fetchImpl: fakeFetch(fixture("anthropic", "text-stream.sse")),
  })
  expect(await collect(p.stream([{ role: "user", content: "hi" }], emptyTools, {}))).toEqual([
    { type: "token", text: "Hi" },
    { type: "token", text: "!" },
    { type: "done", content: "Hi!" },
  ])
})

test("anthropic: aggregates streamed tool_use blocks", async () => {
  const p = new Anthropic({
    apiKey: "k",
    model: "m",
    contextWindow: 200000,
    fetchImpl: fakeFetch(fixture("anthropic", "tool-use.sse")),
  })
  expect(await collect(p.stream([], emptyTools, {}))).toEqual([
    { type: "toolCall", id: "t1", name: "read", input: { path: "a.txt" } },
    { type: "done", content: null },
  ])
})

test("anthropic: adds cache_control breakpoints to messages[1] and the last message", () => {
  const msgs: Message[] = [
    { role: "user", content: "u0" },
    { role: "user", content: "u1" },
    { role: "user", content: "u2" },
  ]
  const out = toAnthropicMessages(msgs)
  expect(out[0].content).toBe("u0")
  expect((out[1].content as { cache_control?: unknown }[])[0].cache_control).toEqual({ type: "ephemeral" })
  expect((out[2].content as { cache_control?: unknown }[])[0].cache_control).toEqual({ type: "ephemeral" })
})
