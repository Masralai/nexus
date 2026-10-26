import type { Tool } from "../engine/types"

type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"
type TodoItem = { id: string; content: string; status: TodoStatus; priority?: string }

const FALLBACK = new Map<string, TodoItem[]>()

interface DocumentStore {
  getDocument?(id: string): { data: unknown } | undefined
  putDocument?(record: { id: string; kind: string; data: unknown; sessionId?: string }): void
}

function keyFor(ctx: { cwd: string; sessionId?: string }): string {
  return `todos_${ctx.sessionId ?? ctx.cwd}`
}

function validStatus(value: unknown): value is TodoStatus {
  return value === "pending" || value === "in_progress" || value === "completed" || value === "cancelled"
}

function readTodos(ctx: { cwd: string; sessionId?: string; store?: unknown }): TodoItem[] {
  const store = ctx.store as DocumentStore | undefined
  const doc = store?.getDocument?.(keyFor(ctx))
  if (doc?.data && Array.isArray((doc.data as { todos?: unknown }).todos)) {
    return (doc.data as { todos: TodoItem[] }).todos
  }
  return FALLBACK.get(keyFor(ctx)) ?? []
}

function writeTodos(ctx: { cwd: string; sessionId?: string; store?: unknown }, todos: TodoItem[]): void {
  const store = ctx.store as DocumentStore | undefined
  if (store?.putDocument) {
    store.putDocument({ id: keyFor(ctx), sessionId: ctx.sessionId, kind: "todos", data: { todos } })
  } else {
    FALLBACK.set(keyFor(ctx), todos)
  }
}

function render(todos: TodoItem[]): string {
  if (todos.length === 0) return "no todos"
  return todos.map((t, i) => `${i + 1}. [${t.status}] ${t.content}${t.priority ? ` (${t.priority})` : ""}`).join("\n")
}

export const todowrite: Tool = {
  name: "todowrite",
  description:
    "Manage a durable todo list. Input: { todos: [{content, status, priority?}], merge?: boolean } or { action: 'list'|'clear' }. Use to track multi-step tasks; list survives restart.",
  schema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string" },
            status: { type: "string" },
            priority: { type: "string" },
          },
          required: ["content", "status"],
        },
      },
      merge: { type: "boolean" },
      action: { type: "string" },
    },
  },
  readonly: false,
  async execute(input, ctx) {
    const { todos, action, merge } = input as {
      todos?: { content: string; status: string; priority?: string }[]
      action?: string
      merge?: boolean
    }
    if (action === "list" || (!todos && action !== "clear")) {
      return { ok: true, output: render(readTodos(ctx)) }
    }
    if (action === "clear") {
      writeTodos(ctx, [])
      return { ok: true, output: "cleared" }
    }
    if (!todos) return { ok: false, output: "", error: "todos or action required" }
    const mapped: TodoItem[] = todos.map((t, i) => ({
      id: String(i + 1),
      content: String(t.content),
      status: validStatus(t.status) ? t.status : "pending",
      priority: t.priority,
    }))
    const next = merge ? [...readTodos(ctx), ...mapped] : mapped
    writeTodos(ctx, next)
    return { ok: true, output: `todos updated: ${next.length} items` }
  },
}

export const todoread: Tool = {
  name: "todoread",
  description: "Read the durable todo list. Input: {}",
  schema: { type: "object", properties: {} },
  readonly: true,
  async execute(_input, ctx) {
    return { ok: true, output: render(readTodos(ctx)) }
  },
}
