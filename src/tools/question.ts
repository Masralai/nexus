import type { QuestionAnswer, QuestionPrompt, Tool } from "../engine/types"

export const question: Tool = {
  name: "question",
  description:
    "Ask the user structured questions through the attached client. Input: { questions: [{header, question, options: [{label, description?}]}] }. In headless mode without a client this fails instead of pretending the user answered.",
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
            options: {
              type: "array",
              items: {
                type: "object",
                properties: { label: { type: "string" }, description: { type: "string" } },
                required: ["label"],
              },
            },
          },
          required: ["header", "question", "options"],
        },
      },
    },
    required: ["questions"],
  },
  readonly: false,
  async execute(input, ctx) {
    const { questions } = input as { questions: QuestionPrompt[] }
    if (!Array.isArray(questions) || questions.length === 0) {
      return { ok: false, output: "", error: "questions required" }
    }
    if (!ctx.askQuestion) {
      return {
        ok: false,
        output: "",
        error: "no interactive client attached; question requires a server or TUI client",
      }
    }
    const answers: QuestionAnswer[] = await ctx.askQuestion(
      questions,
      ctx.toolCallId ?? ctx.sessionId ?? "question",
    )
    return {
      ok: true,
      output: answers.map((a) => `[${a.header}] ${a.question}\nAnswer: ${a.answer}`).join("\n\n"),
    }
  },
}
