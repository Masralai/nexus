import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LspManager } from "./lsp"

test("LSP stdio stub answers definition and symbol queries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-lsp-"))
  const script = join(dir, "stub-lsp.mjs")
  writeFileSync(join(dir, "a.ts"), "export const value = 1\n")
  writeFileSync(
    script,
    `
let buffer = ""
function reply(id, result) {
  const body = JSON.stringify({ jsonrpc: "2.0", id, result })
  process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body)
}
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString()
  while (true) {
    const headerEnd = buffer.indexOf("\\r\\n\\r\\n")
    if (headerEnd === -1) return
    const length = Number(/Content-Length:\\s*(\\d+)/i.exec(buffer.slice(0, headerEnd))[1])
    const total = headerEnd + 4 + length
    if (buffer.length < total) return
    const message = JSON.parse(buffer.slice(headerEnd + 4, total))
    buffer = buffer.slice(total)
    if (message.method === "initialize") reply(message.id, { capabilities: {} })
    if (message.method === "textDocument/definition") {
      reply(message.id, [{ uri: "file://" + process.cwd() + "/a.ts", range: { start: { line: 0, character: 0 } } }])
    }
    if (message.method === "textDocument/documentSymbol") {
      reply(message.id, [{ name: "value", kind: 13, range: { start: { line: 0 } } }])
    }
  }
})
`,
  )

  const manager = new LspManager(
    { stub: { command: [process.execPath, script], extensions: [".ts"] } },
    dir,
  )
  try {
    expect(await manager.query({ operation: "definition", file: "a.ts", line: 1, character: 1 })).toEqual({
      ok: true,
      output: "a.ts:1:1",
    })
    expect(manager.status()).toEqual([{ name: "stub", running: true, root: undefined }])
    expect(await manager.query({ operation: "documentSymbol", file: "a.ts" })).toEqual({
      ok: true,
      output: "value (kind 13) @1",
    })
  } finally {
    manager.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
