import type { EngineEvent, QuestionAnswer, QuestionPrompt } from "../engine/types"
import type { WireEvent } from "../sdk/client"

const TURN_EVENTS = new Set([
  "messageAdded",
  "tokenDelta",
  "toolCallStarted",
  "toolResult",
  "permissionRequest",
  "questionRequest",
  "contextUpdate",
  "usage",
  "turnComplete",
  "stepLimit",
  "runComplete",
  "error",
  "aborted",
])

export interface ServerTurnClient {
  events(opts: { sessionID?: string; after?: number; signal?: AbortSignal }): AsyncIterable<WireEvent>
  replyPermission(sessionID: string, requestID: string, decision: boolean | "always" | "once" | "deny"): Promise<unknown>
  replyQuestion(sessionID: string, requestID: string, answers: unknown[]): Promise<unknown>
}

export interface ServerTurnOptions {
  sessionID: string
  after: number
  signal?: AbortSignal
  onEvent: (event: EngineEvent) => void
  onPermission: (request: { id: string; name: string; input: unknown; reason: string }) => Promise<boolean>
  onQuestion: (requestID: string, questions: QuestionPrompt[]) => Promise<QuestionAnswer[]>
}

function terminal(event: EngineEvent): boolean {
  return event.type === "runComplete" || event.type === "aborted" || event.type === "error"
}

/** Consume a server Turn and resolve permission/question requests through callbacks. */
export async function runServerTurn(client: ServerTurnClient, opts: ServerTurnOptions): Promise<EngineEvent | undefined> {
  for await (const event of client.events({ sessionID: opts.sessionID, after: opts.after, signal: opts.signal })) {
    if (!TURN_EVENTS.has(event.type)) continue
    if (event.type === "permissionRequest") {
      const request = {
        id: String(event.data.id ?? ""),
        name: String(event.data.name ?? "tool"),
        input: event.data.input,
        reason: String(event.data.reason ?? ""),
      }
      const ok = await opts.onPermission(request)
      await client.replyPermission(opts.sessionID, request.id, ok ? "once" : "deny")
      continue
    }
    if (event.type === "questionRequest") {
      const requestID = String(event.data.id ?? "latest")
      const questions = (event.data.questions ?? []) as QuestionPrompt[]
      await client.replyQuestion(opts.sessionID, requestID, await opts.onQuestion(requestID, questions))
      continue
    }
    const ev = { type: event.type, ...event.data } as EngineEvent
    if (terminal(ev)) return ev
    opts.onEvent(ev)
  }
  return undefined
}
