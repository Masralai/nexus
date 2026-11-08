import { expect, test } from "bun:test"
import { Gemini, toGeminiContents } from "./gemini"
import type { ProviderEvent } from "./types"
import type { Message, ToolDefinition } from "../engine/types"

async function collect(iter: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = []
  for await (const event of iter) events.push(event)
  return events
}

test("Gemini converts images, tool calls, and tool results", () => {
  const messages: Message[] = [
    { role: "user", content: "look", images: [{ mimeType: "image/png", data: "aGk=" }] },
    { role: "assistant", content: null, toolCalls: [{ id: "c1", name: "read", input: { path: "a" } }] },
    { role: "tool", toolCallId: "c1", name: "read", result: { ok: true, output: "done" } },
  ]
  expect(toGeminiContents(messages)).toEqual([
    {
      role: "user",
      parts: [
        { text: "look" },
        { inlineData: { mimeType: "image/png", data: "aGk=" } },
      ],
    },
    { role: "model", parts: [{ functionCall: { name: "read", args: { path: "a" } } }] },
    { role: "user", parts: [{ functionResponse: { name: "read", response: { output: "done" } } }] },
  ])
})

test("Gemini streams text, tool calls, and usage", async () => {
  const requests: Array<{ url: string; body: string }> = []
  const sse = [
    `data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}`,
    `data: {"candidates":[{"content":{"parts":[{"text":"lo"},{"functionCall":{"name":"read","args":{"path":"a"}}}]}}]}`,
    `data: {"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":2,"cachedContentTokenCount":4}}`,
    "",
  ].join("\n\n")
  const p = new Gemini({
    apiKey: "k",
    model: "gemini-2.5-pro",
    contextWindow: 1_000_000,
    fetchImpl: (async (url: string, init: RequestInit) => {
      requests.push({ url, body: String(init.body) })
      return new Response(sse, { status: 200 })
    }) as unknown as typeof fetch,
  })
  const tools: ToolDefinition[] = [{ name: "read", description: "Read", schema: { type: "object" } }]
  expect(await collect(p.stream([{ role: "user", content: "hi" }], tools, { system: "SYS" }))).toEqual([
    { type: "token", text: "Hel" },
    { type: "token", text: "lo" },
    { type: "toolCall", id: "call_read_0", name: "read", input: { path: "a" } },
    { type: "done", content: "Hello", usage: { inputTokens: 10, outputTokens: 2, reasoningTokens: undefined, cacheReadTokens: 4 } },
  ])
  expect(requests[0].url).toContain("/models/gemini-2.5-pro:streamGenerateContent?alt=sse")
  expect(requests[0].body).toContain('"systemInstruction"')
  expect(requests[0].body).toContain('"functionDeclarations"')
})
