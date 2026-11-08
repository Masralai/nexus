/**
 * Shared HTTP contract for the local Nexus server and its clients.
 *
 * Paths and envelopes follow the opencode wire shape: `/api/...` with
 * `{ data: ... }` for successful payloads and `{ error: ... }` for failures.
 * Keeping the route table here lets the router, tests, and SDK agree without
 * duplicating strings.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

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

  location: { method: "GET", path: "/api/location" },
  locationReload: { method: "POST", path: "/api/location/reload" },
  debugLocations: { method: "GET", path: "/api/debug/location" },
  debugEvict: { method: "DELETE", path: "/api/debug/location" },

  fsList: { method: "GET", path: "/api/fs/list" },
  fsRead: { method: "GET", path: "/api/fs/read/*" },
  fsFind: { method: "GET", path: "/api/fs/find" },
  fsWrite: { method: "POST", path: "/api/experimental/fs/write" },

  mcpList: { method: "GET", path: "/api/mcp" },
  mcpAdd: { method: "PUT", path: "/api/experimental/mcp/:server" },
  mcpRemove: { method: "DELETE", path: "/api/experimental/mcp/:server" },
  mcpConnect: { method: "POST", path: "/api/experimental/mcp/:server/connect" },
  mcpDisconnect: { method: "POST", path: "/api/experimental/mcp/:server/disconnect" },
  mcpResources: { method: "GET", path: "/api/mcp/resource" },

  ptyList: { method: "GET", path: "/api/pty" },
  ptyCreate: { method: "POST", path: "/api/pty" },
  ptyGet: { method: "GET", path: "/api/pty/:ptyID" },
  ptyUpdate: { method: "PUT", path: "/api/pty/:ptyID" },
  ptyRemove: { method: "DELETE", path: "/api/pty/:ptyID" },
  ptyInput: { method: "POST", path: "/api/pty/:ptyID/input" },
  ptyOutput: { method: "GET", path: "/api/pty/:ptyID/output" },
  persistentPtyList: { method: "GET", path: "/api/experimental/session/:sessionID/terminal" },
  persistentPtyCreate: { method: "POST", path: "/api/experimental/session/:sessionID/terminal" },
  persistentPtyGet: { method: "GET", path: "/api/experimental/persistent-pty/:ptyID" },
  persistentPtyRemove: { method: "DELETE", path: "/api/experimental/persistent-pty/:ptyID" },

  pluginList: { method: "GET", path: "/api/plugin" },
  projectList: { method: "GET", path: "/api/project" },
  projectUpdate: { method: "PATCH", path: "/api/project/:projectID" },
  referenceList: { method: "GET", path: "/api/reference" },
  formList: { method: "GET", path: "/api/form" },
  generate: { method: "POST", path: "/api/experimental/generate" },

  sessions: { method: "GET", path: "/api/session" },
  sessionCreate: { method: "POST", path: "/api/session" },
  sessionImport: { method: "POST", path: "/api/session/import" },
  session: { method: "GET", path: "/api/session/:sessionID" },
  sessionUpdate: { method: "PATCH", path: "/api/session/:sessionID" },
  sessionDelete: { method: "DELETE", path: "/api/session/:sessionID" },
  sessionRevert: { method: "POST", path: "/api/session/:sessionID/revert" },
  sessionFork: { method: "POST", path: "/api/session/:sessionID/fork" },
  sessionExport: { method: "GET", path: "/api/session/:sessionID/export" },
  sessionUsage: { method: "GET", path: "/api/session/:sessionID/usage" },
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

/** Build a concrete path from a route name and its `:params` or trailing `*`. */
export function routePath(name: RouteName, params: Record<string, string | number> = {}): string {
  return ROUTES[name].path.replace(/:([A-Za-z0-9_]+)|\*/g, (match, key?: string) => {
    const param = key ?? "*"
    const value = params[param]
    if (value === undefined) throw new Error(`route ${name} requires param ${param}`)
    return match === "*"
      ? String(value).split("/").map(encodeURIComponent).join("/")
      : encodeURIComponent(String(value))
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
