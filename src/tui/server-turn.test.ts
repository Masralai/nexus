import { expect, test } from "bun:test"
import type { WireEvent } from "../sdk/client"
import { runServerTurn, type ServerTurnClient } from "./server-turn"

function wire(type: string, data: Record<string, unknown> = {}): WireEvent {
  return { id: String(data.id ?? type), cursor: 1, seq: 1, sessionID: "ses", created: "", type, data }
}

test("server turn forwards events and resolves permissions", async () => {
  const replies: unknown[] = []
  const seen: string[] = []
  const client: ServerTurnClient = {
    async *events() {
      yield wire("sessionStatus", { status: "running" })
      yield wire("toolCallStarted", { id: "t1", name: "read", input: {} })
      yield wire("permissionRequest", { id: "p1", name: "bash", input: { command: "ls" }, reason: "test" })
      yield wire("tokenDelta", { delta: "ok" })
      yield wire("runComplete", { steps: 1, result: "done" })
      yield wire("tokenDelta", { delta: "late" })
    },
    replyPermission: async (...args) => {
      replies.push(args)
    },
    replyQuestion: async () => undefined,
  }
  const done = await runServerTurn(client, {
    sessionID: "ses",
    after: 0,
    onEvent: (event) => seen.push(event.type),
    onPermission: async () => true,
    onQuestion: async () => [],
  })
  expect(done).toMatchObject({ type: "runComplete", steps: 1 })
  expect(seen).toEqual(["toolCallStarted", "tokenDelta"])
  expect(replies).toEqual([["ses", "p1", "once"]])
})

test("server turn answers questions and stops on abort", async () => {
  const answers: unknown[] = []
  const client: ServerTurnClient = {
    async *events() {
      yield wire("questionRequest", {
        id: "q1",
        questions: [{ header: "Pick", question: "Which?", options: [{ label: "A" }] }],
      })
      yield wire("aborted")
    },
    replyPermission: async () => undefined,
    replyQuestion: async (...args) => {
      answers.push(args)
    },
  }
  const done = await runServerTurn(client, {
    sessionID: "ses",
    after: 5,
    onEvent: () => {},
    onPermission: async () => false,
    onQuestion: async (_id, questions) => [
      { header: questions[0].header, question: questions[0].question, answer: "A" },
    ],
  })
  expect(done).toEqual({ type: "aborted" })
  expect(answers).toEqual([["ses", "q1", [{ header: "Pick", question: "Which?", answer: "A" }]]])
})
