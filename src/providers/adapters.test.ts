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

test("empty assistant messages are omitted from both protocols", () => {
  const msgs: Message[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: null },
    { role: "user", content: "again" },
  ]
  expect(toChatMessages(msgs).map((m) => m.role)).toEqual(["user", "user"])
  expect(toAnthropicMessages(msgs).map((m) => m.role)).toEqual(["user", "user"])
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

test("anthropic: always sends max_tokens and the native system channel", async () => {
  let body: Record<string, unknown> | undefined
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body))
    return new Response(fixture("anthropic", "text-stream.sse"), { status: 200 })
  }) as unknown as typeof fetch
  const p = new Anthropic({ apiKey: "k", model: "m", contextWindow: 200_000, fetchImpl })
  await collect(p.stream([{ role: "user", content: "hi" }], emptyTools, { system: "SYS" }))
  expect(body?.max_tokens).toBe(8_192)
  expect(body?.system).toBe("SYS")
  expect((body?.messages as { role: string; content: unknown }[])[0]).toEqual({
    role: "user",
    content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }],
  })
})

test("openai: sends system first and parses streamed usage", async () => {
  let body: Record<string, unknown> | undefined
  const sse = [
    'data: {"choices":[{"delta":{"content":"Hi"}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":4},"completion_tokens_details":{"reasoning_tokens":1}}}',
    "data: [DONE]",
    "",
  ].join("\n\n")
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body))
    return new Response(sse, { status: 200 })
  }) as unknown as typeof fetch
  const p = new OpenAICompatible({ apiKey: "k", model: "m", contextWindow: 8_000, fetchImpl })
  const evts = await collect(p.stream([{ role: "user", content: "hi" }], emptyTools, { system: "SYS" }))
  expect(body?.stream_options).toEqual({ include_usage: true })
  expect((body?.messages as { role: string; content: unknown }[])[0]).toEqual({ role: "system", content: "SYS" })
  expect(evts.at(-1)).toEqual({
    type: "done",
    content: "Hi",
    usage: { inputTokens: 10, outputTokens: 2, reasoningTokens: 1, cacheReadTokens: 4 },
  })
})
