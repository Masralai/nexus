import type { Tool } from "../engine/types"

function isEnabled(): boolean {
  return process.env.NEXUS_EXPERIMENTAL_LSP_TOOL === "true" || process.env.NEXUS_EXPERIMENTAL === "true"
}

export const lsp: Tool = {
  name: "lsp",
  description:
    "Language-server code intelligence. Input: { operation: 'goToDefinition'|'findReferences'|'hover'|'documentSymbol'|'workspaceSymbol'|'goToImplementation', file?, line?, character?, query? }. 1-based line/character. Servers are configured under lsp in .nexus.json.",
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
  outputLimit: 12_000,
  async execute(input, ctx) {
    if (!isEnabled()) return { ok: false, output: "", error: "lsp disabled — set NEXUS_EXPERIMENTAL_LSP_TOOL=true" }
    if (!ctx.lsp) return { ok: false, output: "", error: "no lsp servers configured" }
    return ctx.lsp.query(input as { operation: string; file?: string; line?: number; character?: number; query?: string })
  },
}
