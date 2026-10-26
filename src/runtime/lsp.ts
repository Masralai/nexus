import { existsSync, readFileSync } from "node:fs"
import { extname, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { Subprocess } from "bun"
import type { LspControl } from "../engine/types"
import type { LspServerConfig } from "../cli/config"

type RpcMessage = {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const LANGUAGE: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".lua": "lua",
  ".sh": "shellscript",
  ".md": "markdown",
  ".html": "html",
  ".css": "css",
  ".vue": "vue",
  ".svelte": "svelte",
}

function commandFor(cfg: LspServerConfig): string[] {
  if (Array.isArray(cfg.command)) return [...cfg.command, ...(cfg.args ?? [])]
  return ["bash", "-lc", [cfg.command, ...(cfg.args ?? [])].join(" ")]
}

class LspServer {
  private proc: Subprocess<"pipe", "pipe", "pipe">
  private buffer = Buffer.alloc(0)
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private opened = new Set<string>()
  connected = false
  error?: string

  constructor(readonly name: string, readonly config: LspServerConfig, readonly cwd: string) {
    const cmd = commandFor(config)
    this.proc = Bun.spawn(cmd, {
      cwd,
      env: { ...process.env, ...config.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    void this.readLoop(this.proc.stdout)
    this.proc.exited.then(() => {
      this.connected = false
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error(`lsp server ${name} exited`))
      }
      this.pending.clear()
    })
  }

  private async readLoop(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      this.buffer = Buffer.concat([this.buffer, Buffer.from(value)])
      while (true) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n")
        if (headerEnd === -1) break
        const header = this.buffer.subarray(0, headerEnd).toString()
        const match = /Content-Length:\s*(\d+)/i.exec(header)
        if (!match) {
          this.buffer = this.buffer.subarray(headerEnd + 4)
          continue
        }
        const length = Number(match[1])
        const total = headerEnd + 4 + length
        if (this.buffer.length < total) break
        const body = this.buffer.subarray(headerEnd + 4, total).toString()
        this.buffer = this.buffer.subarray(total)
        let msg: RpcMessage
        try {
          msg = JSON.parse(body) as RpcMessage
        } catch {
          continue
        }
        if (msg.id === null || msg.id === undefined) continue
        const waiter = this.pending.get(Number(msg.id))
        if (!waiter) continue
        this.pending.delete(Number(msg.id))
        clearTimeout(waiter.timer)
        if (msg.error) waiter.reject(new Error(`${msg.error.message} (${msg.error.code})`))
        else waiter.resolve(msg.result)
      }
    }
  }

  private write(message: RpcMessage): void {
    const body = JSON.stringify(message)
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    this.proc.stdin.flush()
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (!this.connected && method !== "initialize") return Promise.reject(new Error(`lsp server ${this.name} is not connected`))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`lsp request timed out: ${method}`))
      }, 15_000)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.write({ jsonrpc: "2.0", id, method, params: params ?? {} })
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e as Error)
      }
    })
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: "2.0", method, params: params ?? {} })
  }

  async initialize(): Promise<void> {
    const root = this.config.root ?? this.cwd
    await this.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(root).href,
      rootPath: root,
      workspaceFolders: [{ uri: pathToFileURL(root).href, name: root.split("/").pop() ?? "workspace" }],
      capabilities: {
        textDocument: {
          definition: { linkSupport: true },
          references: {},
          hover: { contentFormat: ["markdown", "plaintext"] },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          implementation: { linkSupport: true },
        },
        workspace: { symbol: {} },
      },
    })
    this.connected = true
    this.notify("initialized", {})
  }

  async open(file: string): Promise<void> {
    const full = resolve(this.cwd, file)
    if (!existsSync(full)) throw new Error(`file not found: ${file}`)
    const uri = pathToFileURL(full).href
    if (this.opened.has(uri)) return
    const text = readFileSync(full, "utf8")
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: this.config.languageId ?? LANGUAGE[extname(full)] ?? "plaintext",
        version: 1,
        text,
      },
    })
    this.opened.add(uri)
  }

  uri(file: string): string {
    return pathToFileURL(resolve(this.cwd, file)).href
  }

  close(): void {
    try {
      this.proc.kill()
    } catch {
      /* already dead */
    }
  }
}

function locations(result: unknown, cwd: string): string[] {
  const out: string[] = []
  const one = (loc: unknown): void => {
    if (!loc || typeof loc !== "object") return
    const o = loc as { uri?: string; targetUri?: string; range?: { start?: { line?: number; character?: number } } }
    const uri = o.uri ?? o.targetUri
    if (!uri) return
    const file = decodeURIComponent(uri.replace(/^file:\/\//, ""))
    const rel = file.startsWith(cwd + "/") ? file.slice(cwd.length + 1) : file
    out.push(`${rel}:${(o.range?.start?.line ?? 0) + 1}:${(o.range?.start?.character ?? 0) + 1}`)
  }
  if (Array.isArray(result)) for (const item of result) one(item)
  else one(result)
  return out
}

export class LspManager implements LspControl {
  private servers = new Map<string, LspServer>()
  private starting = new Map<string, Promise<LspServer>>()

  constructor(private readonly config: Record<string, LspServerConfig>, private readonly cwd: string) {}

  private async serverFor(file?: string): Promise<LspServer> {
    const entries = Object.entries(this.config)
    if (entries.length === 0) throw new Error("no lsp servers configured (add lsp to .nexus.json)")
    const ext = file ? extname(file) : ""
    const chosen = entries.find(([, cfg]) => !cfg.extensions || cfg.extensions.includes(ext)) ?? entries[0]
    const [name, cfg] = chosen
    const existing = this.servers.get(name)
    if (existing?.connected) return existing
    const starting = this.starting.get(name)
    if (starting) return starting
    const p = (async () => {
      const server = new LspServer(name, cfg, cfg.root ?? this.cwd)
      try {
        await server.initialize()
      } catch (e) {
        server.error = e instanceof Error ? e.message : String(e)
        server.close()
        throw e
      }
      this.servers.set(name, server)
      return server
    })().finally(() => {
      this.starting.delete(name)
    })
    this.starting.set(name, p)
    return p
  }

  async query(input: {
    operation: string
    file?: string
    line?: number
    character?: number
    query?: string
  }): Promise<{ ok: boolean; output: string; error?: string }> {
    try {
      const server = await this.serverFor(input.file)
      if (input.file) await server.open(input.file)
      const position = {
        line: Math.max(0, (input.line ?? 1) - 1),
        character: Math.max(0, (input.character ?? 1) - 1),
      }
      const textDocument = input.file ? { uri: server.uri(input.file) } : undefined
      let result: unknown
      switch (input.operation) {
        case "goToDefinition":
        case "definition":
          result = await server.request("textDocument/definition", { textDocument, position })
          break
        case "goToImplementation":
        case "implementation":
          result = await server.request("textDocument/implementation", { textDocument, position })
          break
        case "findReferences":
        case "references":
          result = await server.request("textDocument/references", {
            textDocument,
            position,
            context: { includeDeclaration: true },
          })
          break
        case "hover":
          result = await server.request("textDocument/hover", { textDocument, position })
          break
        case "documentSymbol":
          result = await server.request("textDocument/documentSymbol", { textDocument })
          break
        case "workspaceSymbol":
          result = await server.request("workspace/symbol", { query: input.query ?? "" })
          break
        default:
          return { ok: false, output: "", error: `unsupported lsp operation: ${input.operation}` }
      }
      if (input.operation === "hover") {
        const h = result as { contents?: unknown }
        const contents = h?.contents
        if (typeof contents === "string") return { ok: true, output: contents }
        if (contents && typeof contents === "object" && "value" in (contents as object)) {
          return { ok: true, output: String((contents as { value: unknown }).value) }
        }
        return { ok: true, output: JSON.stringify(contents ?? result) }
      }
      if (input.operation === "documentSymbol") {
        const symbols = (result ?? []) as Array<{ name?: string; kind?: number; range?: { start?: { line?: number } }; location?: { range?: { start?: { line?: number } } } }>
        return {
          ok: true,
          output: symbols
            .map((s) => `${s.name ?? "?"} (kind ${s.kind ?? "?"}) @${(s.range?.start?.line ?? s.location?.range?.start?.line ?? 0) + 1}`)
            .join("\n"),
        }
      }
      if (input.operation === "workspaceSymbol") {
        const symbols = (result ?? []) as Array<{ name?: string; location?: { uri?: string; range?: { start?: { line?: number } } } }>
        return {
          ok: true,
          output: symbols
            .map((s) => {
              const uri = s.location?.uri ?? ""
              const rel = uri.startsWith("file://") ? uri.slice(7) : uri
              return `${s.name ?? "?"} ${rel}:${(s.location?.range?.start?.line ?? 0) + 1}`
            })
            .join("\n"),
        }
      }
      const found = locations(result, this.cwd)
      return { ok: true, output: found.join("\n") || "no results" }
    } catch (e) {
      return { ok: false, output: "", error: e instanceof Error ? e.message : String(e) }
    }
  }

  status(): Array<{ name: string; running: boolean; root?: string }> {
    return Object.entries(this.config).map(([name, cfg]) => ({
      name,
      running: Boolean(this.servers.get(name)?.connected),
      root: cfg.root,
    }))
  }

  close(): void {
    for (const server of this.servers.values()) server.close()
    this.servers.clear()
  }
}
