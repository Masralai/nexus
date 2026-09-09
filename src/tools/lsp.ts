import type { Tool } from "../engine/types"

function isEnabled(): boolean {
  return process.env.OPENCODE_EXPERIMENTAL_LSP_TOOL === "true" || process.env.OPENCODE_EXPERIMENTAL === "true"
}

export const lsp: Tool = {
  name: "lsp",
  description: "LSP code intelligence. Input: { operation: 'goToDefinition'|'findReferences'|'hover'|'documentSymbol'|'workspaceSymbol'|'goToImplementation', file?: string, line?: number, character?: number, query?: string } . Requires OPENCODE_EXPERIMENTAL_LSP_TOOL=true",
  schema: {
    type: "object",
    properties: {
      operation: { type: "string" },
      file: { type: "string" },
      line: { type: "number" },
      character: { type: "number" },
      query: { type: "string" },
    },
    required: ["operation"],
  },
  readonly: true,
  async execute(input) {
    if (!isEnabled()) return { ok: false, output: "", error: "lsp disabled — set OPENCODE_EXPERIMENTAL_LSP_TOOL=true" }
    const { operation } = input as { operation: string }
    // Stub: real LSP servers would be configured via opencode.json lsp servers
    // For now, provide a helpful message directing to grep/read
    return {
      ok: true,
      output: `lsp:${operation} — experimental stub. Use grep/read for navigation. Configure servers in opencode.json to enable full LSP.`,
    }
  },
}
