import type { Tool } from "../engine/types"

export const question: Tool = {
  name: "question",
  description: "Ask the user questions. Input: { questions: [{header, question, options: [{label, description}]}] }",
  schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            header: { type: "string" },
            question: { type: "string" },
            options: { type: "array", items: { type: "object", properties: { label: { type: "string" }, description: { type: "string" } }, required: ["label"] } },
          },
          required: ["header", "question", "options"],
        },
      },
    },
    required: ["questions"],
  },
  readonly: false,
  async execute(input, ctx) {
    const { questions } = input as { questions: { header: string; question: string; options: { label: string; description?: string }[] }[] }
    if (!questions?.length) return { ok: false, output: "", error: "questions required" }
    // In headless/CLI the Permission gate will surface question via toolResult; in TUI the loop could intercept
    // For now, record and return the questions as output so the model can see them
    const out = questions.map((q, i) => `Q${i + 1} [${q.header}]: ${q.question}\nOptions: ${q.options.map((o) => `${o.label}${o.description ? ` — ${o.description}` : ""}`).join(" | ")}`).join("\n\n")
    // Also emit via console for debugging (not persisted)
    return { ok: true, output: out }
  },
}
