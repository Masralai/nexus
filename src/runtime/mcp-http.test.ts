import { expect, test } from "bun:test"
import { McpManager } from "./mcp"

test("MCP HTTP transport reports request failures as disconnected", async () => {
  let fail = false
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (fail) return new Response("boom", { status: 500 })
      const message = (await req.json()) as { id?: number; method?: string; params?: { uri?: string } }
      const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: message.id, result })
      if (message.method === "initialize") return reply({ protocolVersion: "2024-11-05", serverInfo: { name: "stub" }, capabilities: {} })
      if (message.method === "notifications/initialized") return new Response(null, { status: 202 })
      if (message.method === "tools/list") return reply({ tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }] })
      if (message.method === "resources/list") return reply({ resources: [{ uri: "file:///x", name: "x" }] })
      if (message.method === "resources/read") return reply({ contents: [{ uri: message.params?.uri, text: "hi" }] })
      if (message.method === "prompts/list") return reply({ prompts: [] })
      if (message.method === "tools/call") return reply({ content: [{ type: "text", text: "ok" }] })
      return new Response("not found", { status: 404 })
    },
  })

  const manager = new McpManager({ stub: { type: "http", url: `http://127.0.0.1:${server.port}/mcp` } }, process.cwd())
  try {
    await manager.connect()
    expect(manager.status()[0]).toMatchObject({ connected: true, transport: "http" })

    fail = true
    const result = await manager.call("stub", "echo", { value: 1 })
    expect(result.ok).toBe(false)
    expect(result.error).toContain("HTTP 500")
    expect(manager.status()[0]).toMatchObject({ connected: false })

    fail = false
    const recovered = await manager.call("stub", "echo", { value: 2 })
    expect(recovered).toEqual({ ok: true, output: "ok" })
    expect(manager.status()[0]).toMatchObject({ connected: true })

    fail = true
    await expect(manager.readResource("stub", "file:///x")).rejects.toThrow("HTTP 500")
    expect(manager.status()[0]).toMatchObject({ connected: false })

    fail = false
    expect(await manager.readResource("stub", "file:///x")).toEqual({ contents: [{ uri: "file:///x", text: "hi" }] })
    expect(manager.status()[0]).toMatchObject({ connected: true })
  } finally {
    await manager.close()
    server.stop(true)
  }
})
