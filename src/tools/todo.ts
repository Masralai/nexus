import type { Tool } from "../engine/types"

type TodoItem = { id: string; content: string; status: "pending" | "in_progress" | "completed" }
const store = new Map<string, TodoItem[]>()

function keyFor(cwd: string): string { return cwd }

export const todowrite: Tool = {
  name: "todowrite",
  description: "Manage todo lists. Input: { todos: [{content, status, priority?}], merge?: boolean } or { action: 'list' }. Use to track multi-step tasks.",
  schema: {
    type: "object",
    properties: {
      todos: { type: "array", items: { type: "object", properties: { content: { type: "string" }, status: { type: "string" }, priority: { type: "string" } }, required: ["content", "status"] } },
      action: { type: "string" },
    },
  },
  readonly: false,
  async execute(input, ctx) {
    const { todos, action } = input as { todos?: { content: string; status: string; priority?: string }[]; action?: string }
    const key = keyFor(ctx.cwd)
    if (action === "list" || (!todos && action !== "clear")) {
      const cur = store.get(key) ?? []
      if (cur.length === 0) return { ok: true, output: "no todos" }
      return { ok: true, output: cur.map((t, i) => `${i + 1}. [${t.status}] ${t.content}`).join("\n") }
    }
    if (action === "clear") {
      store.delete(key)
      return { ok: true, output: "cleared" }
    }
    if (todos) {
      const mapped: TodoItem[] = todos.map((t, i) => ({ id: String(i + 1), content: t.content, status: t.status as TodoItem["status"] }))
      store.set(key, mapped)
      return { ok: true, output: `todos updated: ${mapped.length} items` }
    }
    return { ok: false, output: "", error: "todos or action required" }
  },
}

export const todoread: Tool = {
  name: "todoread",
  description: "Read todo list. Input: {}",
  schema: { type: "object", properties: {} },
  readonly: true,
  async execute(_input, ctx) {
    const key = keyFor(ctx.cwd)
    const cur = store.get(key) ?? []
    if (cur.length === 0) return { ok: true, output: "no todos" }
    return { ok: true, output: cur.map((t, i) => `${i + 1}. [${t.status}] ${t.content}`).join("\n") }
  },
}
