/**
 * Shared HTTP contract for the local Nexus server and its clients.
 *
 * Paths and envelopes follow the opencode wire shape: `/api/...` with
 * `{ data: ... }` for successful payloads and `{ error: ... }` for failures.
 * Keeping the route table here lets the router, tests, and SDK agree without
 * duplicating strings.
 */

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE"

export interface RouteDefinition {
  method: HttpMethod
  path: string
}

export const ROUTES = {
  info: { method: "GET", path: "/api/info" },
  config: { method: "GET", path: "/api/config" },
  providers: { method: "GET", path: "/api/provider" },
  provider: { method: "GET", path: "/api/provider/:providerID" },
  models: { method: "GET", path: "/api/model" },
  modelDefault: { method: "GET", path: "/api/model/default" },
  agents: { method: "GET", path: "/api/agent" },
  commands: { method: "GET", path: "/api/command" },
  tools: { method: "GET", path: "/api/tool" },

  sessions: { method: "GET", path: "/api/session" },
  sessionCreate: { method: "POST", path: "/api/session" },
  session: { method: "GET", path: "/api/session/:sessionID" },
  sessionUpdate: { method: "PATCH", path: "/api/session/:sessionID" },
  sessionDelete: { method: "DELETE", path: "/api/session/:sessionID" },
  messages: { method: "GET", path: "/api/session/:sessionID/message" },
  prompt: { method: "POST", path: "/api/session/:sessionID/prompt" },
  interrupt: { method: "POST", path: "/api/session/:sessionID/interrupt" },
  permissions: { method: "GET", path: "/api/session/:sessionID/permission" },
  permissionReply: { method: "POST", path: "/api/session/:sessionID/permission/:requestID/reply" },
  questions: { method: "GET", path: "/api/session/:sessionID/question" },
  questionReply: { method: "POST", path: "/api/session/:sessionID/question/:requestID/reply" },
  sessionEvents: { method: "GET", path: "/api/session/:sessionID/event" },
  events: { method: "GET", path: "/api/event" },
} as const satisfies Record<string, RouteDefinition>

export type RouteName = keyof typeof ROUTES

/** Build a concrete path from a route name and its `:params`. */
export function routePath(name: RouteName, params: Record<string, string | number> = {}): string {
  return ROUTES[name].path.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => {
    const value = params[key]
    if (value === undefined) throw new Error(`route ${name} requires param ${key}`)
    return encodeURIComponent(String(value))
  })
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
  }
}

export interface DataBody<T> {
  data: T
}

export interface ListBody<T> {
  data: T[]
  cursor: Record<string, string | undefined>
}
