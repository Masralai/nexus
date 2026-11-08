import { expect, test } from "bun:test"
import { OpenAIResponses, toResponsesInput } from "./openai-responses"
import type { ProviderEvent } from "./types"
import type { Message, ToolDefinition } from "../engine/types"

async function collect(iter: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = []
  for await (const event of iter) events.push(event)
  return events
}

test("responses: maps messages, images, calls, and outputs", () => {
  const messages: Message[] = [
    { role: "user", content: "look", images: [{ mimeType: "image/png", data: "aGk=" }] },
    { role: "assistant", content: "checking", toolCalls: [{ id: "call_1", name: "read", input: { path: "a" } }] },
    { role: "tool", toolCallId: "call_1", name: "read", result: { ok: true, output: "done" } },
  ]
  expect(toResponsesInput(messages)).toEqual([
    {
      role: "user",
      content: [
        { type: "input_text", text: "look" },
        { type: "input_image", image_url: "data:image/png;base64,aGk=" },
      ],
    },
    { role: "assistant", content: "checking" },
    { type: "function_call", call_id: "call_1", name: "read", arguments: '{"path":"a"}' },
    { type: "function_call_output", call_id: "call_1", output: "done" },
  ])
})

test("responses: streams text, tool args, and usage", async () => {
  let request: { url: string; body: string; authorization?: string } | undefined
  const sse = [
    `data: {"type":"response.output_text.delta","delta":"Hel"}`,
    `data: {"type":"response.output_text.delta","delta":"lo"}`,
    `data: {"type":"response.output_item.added","output_index":1,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"read","arguments":""}}`,
    `data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\\"path\\":"}`,
    `data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"\\"a\\"}"}`,
    `data: {"type":"response.function_call_arguments.done","item_id":"fc_1","arguments":"{\\"path\\":\\"a\\"}"}`,
    `data: {"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":2,"input_tokens_details":{"cached_tokens":4},"output_tokens_details":{"reasoning_tokens":1}}}}`,
    "",
  ].join("\n\n")
  const provider = new OpenAIResponses({
    apiKey: "k",
    model: "gpt-4.1",
    contextWindow: 200_000,
    fetchImpl: (async (url: string, init: RequestInit) => {
      request = {
        url: String(url),
        body: String(init.body),
        authorization: (init.headers as Record<string, string>).Authorization,
      }
      return new Response(sse, { status: 200 })
    }) as unknown as typeof fetch,
  })
  const tools: ToolDefinition[] = [{ name: "read", description: "Read", schema: { type: "object" } }]
  expect(await collect(provider.stream([{ role: "user", content: "hi" }], tools, { system: "SYS" }))).toEqual([
    { type: "token", text: "Hel" },
    { type: "token", text: "lo" },
    { type: "toolCall", id: "call_1", name: "read", input: { path: "a" } },
    {
      type: "done",
      content: "Hello",
      usage: { inputTokens: 10, outputTokens: 2, reasoningTokens: 1, cacheReadTokens: 4 },
    },
  ])
  expect(request?.url).toBe("https://api.openai.com/v1/responses")
  expect(request?.authorization).toBe("Bearer k")
  expect(request?.body).toContain('"instructions":"SYS"')
  expect(request?.body).toContain('"type":"function"')
})

test("responses: malformed tool args stay correctable", async () => {
  const sse = [
    `data: {"type":"response.output_item.added","output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"read","arguments":""}}`,
    `data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"not json"}`,
    `data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}`,
    "",
  ].join("\n\n")
  const provider = new OpenAIResponses({
    apiKey: "k",
    model: "gpt-4.1",
    contextWindow: 1_000,
    fetchImpl: (async () => new Response(sse, { status: 200 })) as unknown as typeof fetch,
  })
  const events = await collect(provider.stream([{ role: "user", content: "hi" }], [], {}))
  expect(events[0]).toMatchObject({ type: "toolCall", id: "call_1", input: { _raw: "not json" } })
})
