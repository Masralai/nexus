import { randomUUID } from "node:crypto"
import type { McpControl, McpToolInfo, Tool, ToolResult } from "../engine/types"
import type { McpServerConfig } from "../cli/config"

interface JsonRpcResponse {
  jsonrpc?: string
  id?: number | string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface Client {
  name: string
  config: McpServerConfig
  transport: "stdio" | "http" | "sse"
  connected: boolean
  error?: string
  serverInfo?: { name?: string; version?: string }
  toolList: McpToolInfo[]
  resourceList: Array<{ server: string; uri: string; name?: string; mimeType?: string }>
  promptList: Array<{ server: string; name: string; description?: string }>
  request(method: string, params?: unknown): Promise<unknown>
  notify(method: string, params?: unknown): Promise<void>
  close(): Promise<void>
}

function splitCommand(config: McpServerConfig): string[] {
  if (Array.isArray(config.command)) return [...config.command, ...(config.args ?? [])]
  if (config.command) return ["bash", "-lc", [config.command, ...(config.args ?? [])].join(" ")]
  return []
}

function rpcError(error: JsonRpcResponse["error"]): Error {
  const suffix = error?.data === undefined ? "" : `: ${JSON.stringify(error.data)}`
  return new Error(`${error?.message ?? "MCP error"} (${error?.code ?? "unknown"})${suffix}`)
}

class StdioClient implements Client {
  transport = "stdio" as const
  connected = false
  error?: string
  serverInfo?: { name?: string; version?: string }
  toolList: McpToolInfo[] = []
  resourceList: Client["resourceList"] = []
  promptList: Client["promptList"] = []
  private proc: ReturnType<typeof Bun.spawn>
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private buffer = ""
  private stderr = ""

  constructor(readonly name: string, readonly config: McpServerConfig, cwd: string) {
    const cmd = splitCommand(config)
    if (cmd.length === 0) throw new Error(`mcp server ${name}: command is required`)
    this.proc = Bun.spawn(cmd, {
      cwd: config.cwd ?? cwd,
      env: { ...process.env, ...config.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    void this.readLoop(this.proc.stdout)
    void this.readStderr(this.proc.stderr)
    this.proc.exited.then((code) => {
      this.connected = false
      for (const [id, waiter] of this.pending) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error(`mcp server ${name} exited (${code})${this.stderr ? `: ${this.stderr.slice(-400)}` : ""}`))
        this.pending.delete(id)
      }
    })
  }

  private async readStderr(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      this.stderr = (this.stderr + decoder.decode(value, { stream: true })).slice(-8000)
    }
  }

  private async readLoop(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      this.buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, idx).trim()
        this.buffer = this.buffer.slice(idx + 1)
        if (!line) continue
        let msg: JsonRpcResponse
        try {
          msg = JSON.parse(line) as JsonRpcResponse
        } catch {
          continue
        }
        if (msg.id === undefined) continue
        const waiter = this.pending.get(Number(msg.id))
        if (!waiter) continue
        this.pending.delete(Number(msg.id))
        clearTimeout(waiter.timer)
        if (msg.error) waiter.reject(rpcError(msg.error))
        else waiter.resolve(msg.result)
      }
    }
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (!this.connected && method !== "initialize") throw new Error(`mcp server ${this.name} is not connected`)
    const id = this.nextId++
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`mcp request timed out: ${method}`))
      }, 20_000)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.proc.stdin.write(payload + "\n")
        this.proc.stdin.flush()
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e as Error)
      }
    })
  }

  async notify(method: string, params?: unknown): Promise<void> {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params: params ?? {} }) + "\n")
    this.proc.stdin.flush()
  }

  async initialize(): Promise<void> {
    const result = (await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { roots: { listChanged: true } },
      clientInfo: { name: "nexus", version: "1.0.0" },
    })) as { serverInfo?: { name?: string; version?: string } }
    this.serverInfo = result?.serverInfo
    this.connected = true
    await this.notify("notifications/initialized")
    await this.refresh()
  }

  async refresh(): Promise<void> {
    try {
      const tools = (await this.request("tools/list")) as {
        tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>
      }
      this.toolList = (tools.tools ?? []).map((t) => ({
        server: this.name,
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema ?? { type: "object" },
      }))
    } catch {
      this.toolList = []
    }
    try {
      const resources = (await this.request("resources/list")) as {
        resources?: Array<{ uri: string; name?: string; mimeType?: string }>
      }
      this.resourceList = (resources.resources ?? []).map((r) => ({ server: this.name, ...r }))
    } catch {
      this.resourceList = []
    }
    try {
      const prompts = (await this.request("prompts/list")) as {
        prompts?: Array<{ name: string; description?: string }>
      }
      this.promptList = (prompts.prompts ?? []).map((p) => ({ server: this.name, ...p }))
    } catch {
      this.promptList = []
    }
  }

  async close(): Promise<void> {
    this.connected = false
    try {
      await this.notify("notifications/cancelled")
    } catch {
      /* ignore */
    }
    try {
      this.proc.kill()
    } catch {
      /* already dead */
    }
  }
}

class HttpClient implements Client {
  transport = "http" as const
  connected = false
  error?: string
  serverInfo?: { name?: string; version?: string }
  toolList: McpToolInfo[] = []
  resourceList: Client["resourceList"] = []
  promptList: Client["promptList"] = []
  private nextId = 1
  private sessionId?: string

  constructor(readonly name: string, readonly config: McpServerConfig) {
    if (!config.url) throw new Error(`mcp server ${name}: url is required`)
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const res = await fetch(this.config.url!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
        ...(this.config.headers ?? {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params: params ?? {} }),
    })
    const session = res.headers.get("mcp-session-id")
    if (session) this.sessionId = session
    if (!res.ok) throw new Error(`mcp ${this.name}: HTTP ${res.status} ${await res.text()}`)
    const type = res.headers.get("content-type") ?? ""
    if (type.includes("text/event-stream")) {
      const text = await res.text()
      for (const block of text.split("\n\n")) {
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue
          const data = line.slice(5).trim()
          if (!data) continue
          try {
            const msg = JSON.parse(data) as JsonRpcResponse
            if (msg.error) throw rpcError(msg.error)
            if (msg.result !== undefined) return msg.result
          } catch (e) {
            if (e instanceof Error && /MCP error/.test(e.message)) throw e
          }
        }
      }
      return undefined
    }
    const msg = (await res.json()) as JsonRpcResponse
    if (msg.error) throw rpcError(msg.error)
    return msg.result
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await fetch(this.config.url!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
        ...(this.config.headers ?? {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", method, params: params ?? {} }),
    })
  }

  async initialize(): Promise<void> {
    const result = (await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "nexus", version: "1.0.0" },
    })) as { serverInfo?: { name?: string; version?: string } }
    this.serverInfo = result?.serverInfo
    this.connected = true
    await this.notify("notifications/initialized")
    await this.refresh()
  }

  async refresh(): Promise<void> {
    try {
      const tools = (await this.request("tools/list")) as {
        tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>
      }
      this.toolList = (tools.tools ?? []).map((t) => ({
        server: this.name,
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema ?? { type: "object" },
      }))
    } catch {
      this.toolList = []
    }
    try {
      const resources = (await this.request("resources/list")) as {
        resources?: Array<{ uri: string; name?: string; mimeType?: string }>
      }
      this.resourceList = (resources.resources ?? []).map((r) => ({ server: this.name, ...r }))
    } catch {
      this.resourceList = []
    }
    try {
      const prompts = (await this.request("prompts/list")) as {
        prompts?: Array<{ name: string; description?: string }>
      }
      this.promptList = (prompts.prompts ?? []).map((p) => ({ server: this.name, ...p }))
    } catch {
      this.promptList = []
    }
  }

  async close(): Promise<void> {
    this.connected = false
  }
}

export class McpManager implements McpControl {
  private clients = new Map<string, Client>()
  private connecting?: Promise<void>

  constructor(private readonly config: Record<string, McpServerConfig>, private readonly cwd: string) {}

  private create(name: string, cfg: McpServerConfig): Client {
    const type = cfg.type ?? (cfg.url ? "http" : "stdio")
    if (type === "stdio" || type === "local") return new StdioClient(name, cfg, this.cwd)
    return new HttpClient(name, cfg)
  }

  async connect(name?: string): Promise<void> {
    if (name) {
      const cfg = this.config[name]
      if (!cfg) throw new Error(`unknown mcp server: ${name}`)
      const existing = this.clients.get(name)
      if (existing?.connected) return
      if (existing) await existing.close()
      const client = this.create(name, cfg)
      this.clients.set(name, client)
      try {
        await client.initialize()
      } catch (e) {
        client.error = e instanceof Error ? e.message : String(e)
        throw e
      }
      return
    }
    if (this.connecting) return this.connecting
    this.connecting = (async () => {
      for (const [server, cfg] of Object.entries(this.config)) {
        if (cfg.enabled === false) continue
        if (this.clients.get(server)?.connected) continue
        try {
          await this.connect(server)
        } catch {
          /* one bad server must not take down the harness */
        }
      }
    })().finally(() => {
      this.connecting = undefined
    })
    return this.connecting
  }

  async disconnect(name?: string): Promise<void> {
    if (name) {
      const client = this.clients.get(name)
      if (client) await client.close()
      this.clients.delete(name)
      return
    }
    await Promise.all([...this.clients.values()].map((c) => c.close()))
    this.clients.clear()
  }

  tools(): McpToolInfo[] {
    return [...this.clients.values()].flatMap((c) => c.toolList)
  }

  async call(server: string, name: string, input: unknown): Promise<ToolResult> {
    const client = this.clients.get(server)
    if (!client?.connected) return { ok: false, output: "", error: `mcp server not connected: ${server}` }
    try {
      const result = (await client.request("tools/call", { name, arguments: input ?? {} })) as {
        content?: Array<{ type?: string; text?: string; mimeType?: string; data?: string }>
        isError?: boolean
        structuredContent?: unknown
      }
      const parts = (result.content ?? []).map((c) => {
        if (c.type === "text") return c.text ?? ""
        if (c.type === "image") return `[image ${c.mimeType ?? "unknown"}]`
        return JSON.stringify(c)
      })
      if (result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent))
      return { ok: !result.isError, output: parts.join("\n") }
    } catch (e) {
      return { ok: false, output: "", error: e instanceof Error ? e.message : String(e) }
    }
  }

  async resources(server?: string): Promise<Array<{ server: string; uri: string; name?: string; mimeType?: string }>> {
    return [...this.clients.values()]
      .filter((c) => !server || c.name === server)
      .flatMap((c) => c.resourceList)
  }

  async readResource(server: string, uri: string): Promise<unknown> {
    const client = this.clients.get(server)
    if (!client?.connected) throw new Error(`mcp server not connected: ${server}`)
    return client.request("resources/read", { uri })
  }

  async prompts(server?: string): Promise<Array<{ server: string; name: string; description?: string }>> {
    return [...this.clients.values()]
      .filter((c) => !server || c.name === server)
      .flatMap((c) => c.promptList)
  }

  async getPrompt(server: string, name: string, args?: Record<string, string>): Promise<unknown> {
    const client = this.clients.get(server)
    if (!client?.connected) throw new Error(`mcp server not connected: ${server}`)
    return client.request("prompts/get", { name, arguments: args ?? {} })
  }

  status(): Array<{ name: string; connected: boolean; error?: string; transport: string }> {
    return Object.keys(this.config).map((name) => {
      const client = this.clients.get(name)
      return {
        name,
        connected: Boolean(client?.connected),
        error: client?.error,
        transport: client?.transport ?? (this.config[name]?.url ? "http" : "stdio"),
      }
    })
  }

  async close(): Promise<void> {
    await this.disconnect()
  }

  /** Add discovered MCP tools to a Nexus tool registry. */
  registerTools(register: (info: McpToolInfo) => void): void {
    for (const tool of this.tools()) register(tool)
  }
}

export function mcpAsTools(mcp: McpControl): Tool[] {
  return mcp.tools().map((info) => ({
    name: `mcp_${info.server}_${info.name}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
    description: `[MCP ${info.server}] ${info.description}`,
    schema: info.inputSchema,
    readonly: false,
    async execute(input) {
      return mcp.call(info.server, info.name, input)
    },
  }))
}
