import { expect, test } from "bun:test"
import { McpManager } from "./mcp"

test("MCP SSE transport initializes, lists, and calls tools", async () => {
  const encoder = new TextEncoder()
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === "/sse") {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller
            controller.enqueue(encoder.encode("event: endpoint\ndata: /messages\n\n"))
          },
        })
        return new Response(body, { headers: { "content-type": "text/event-stream" } })
      }
      if (url.pathname === "/messages") {
        const message = (await req.json()) as { id?: number; method?: string; params?: unknown }
        const reply = (result: unknown) => {
          stream?.enqueue(encoder.encode(`data: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n\n`))
        }
        if (message.id !== undefined) {
          if (message.method === "initialize") {
            reply({ protocolVersion: "2024-11-05", serverInfo: { name: "stub" }, capabilities: {} })
          } else if (message.method === "tools/list") {
            reply({ tools: [{ name: "echo", description: "Echo input", inputSchema: { type: "object" } }] })
          } else if (message.method === "resources/list") {
            reply({ resources: [{ uri: "file:///x", name: "x" }] })
          } else if (message.method === "prompts/list") {
            reply({ prompts: [{ name: "p", description: "Prompt" }] })
          } else if (message.method === "tools/call") {
            reply({ content: [{ type: "text", text: JSON.stringify(message.params) }] })
          }
        }
        return new Response(null, { status: 202 })
      }
      return new Response("not found", { status: 404 })
    },
  })

  const manager = new McpManager(
    { stub: { type: "sse", url: `http://127.0.0.1:${server.port}/sse` } },
    process.cwd(),
  )
  try {
    await manager.connect()
    expect(manager.status()).toEqual([{ name: "stub", connected: true, error: undefined, transport: "sse" }])
    expect(manager.tools()).toEqual([
      { server: "stub", name: "echo", description: "Echo input", inputSchema: { type: "object" } },
    ])
    expect(await manager.resources()).toEqual([{ server: "stub", uri: "file:///x", name: "x" }])
    expect(await manager.prompts()).toEqual([{ server: "stub", name: "p", description: "Prompt" }])
    expect(await manager.call("stub", "echo", { value: 1 })).toEqual({
      ok: true,
      output: '{"name":"echo","arguments":{"value":1}}',
    })
  } finally {
    await manager.close()
    server.stop(true)
  }
})
