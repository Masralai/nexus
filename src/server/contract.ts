/**
 * Shared HTTP contract for the local Nexus server and its clients.
 *
 * Paths and envelopes follow the reference wire shape: `/api/...` with
 * `{ data: ... }` for successful payloads and `{ error: ... }` for failures.
 * Keeping the route table here lets the router, tests, and SDK agree without
 * duplicating strings.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export interface RouteDefinition {
  method: HttpMethod
  path: string
  /**
   * Response wire for routes that do not answer with a JSON `{ data }` body.
   * `text` routes still get an SDK method; `sse` and `socket` routes are
   * streams and are excluded from the generated request surface.
   */
  wire?: "text" | "sse" | "socket"
}

/** Options accepted by every generated SDK request method. */
export interface RouteInit extends RequestInit {
  query?: Record<string, string | number | undefined>
}

export const ROUTES = {
  info: { method: "GET", path: "/api/info" },
  config: { method: "GET", path: "/api/config" },
  configUpdate: { method: "PATCH", path: "/api/experimental/config" },
  providerVerify: { method: "POST", path: "/api/provider/verify" },
  providers: { method: "GET", path: "/api/provider" },
  provider: { method: "GET", path: "/api/provider/:providerID" },
  models: { method: "GET", path: "/api/model" },
  modelDefault: { method: "GET", path: "/api/model/default" },
  agents: { method: "GET", path: "/api/agent" },
  commands: { method: "GET", path: "/api/command" },
  skills: { method: "GET", path: "/api/skill" },
  tools: { method: "GET", path: "/api/tool" },

  location: { method: "GET", path: "/api/location" },
  locationReload: { method: "POST", path: "/api/location/reload" },
  debugLocations: { method: "GET", path: "/api/debug/location" },
  debugEvict: { method: "DELETE", path: "/api/debug/location" },

  fsList: { method: "GET", path: "/api/fs/list" },
  fsRead: { method: "GET", path: "/api/fs/read/*", wire: "text" },
  fsFind: { method: "GET", path: "/api/fs/find" },
  fsWrite: { method: "POST", path: "/api/experimental/fs/write" },

  mcpList: { method: "GET", path: "/api/mcp" },
  mcpAdd: { method: "PUT", path: "/api/experimental/mcp/:server" },
  mcpRemove: { method: "DELETE", path: "/api/experimental/mcp/:server" },
  mcpConnect: { method: "POST", path: "/api/experimental/mcp/:server/connect" },
  mcpDisconnect: { method: "POST", path: "/api/experimental/mcp/:server/disconnect" },
  mcpResources: { method: "GET", path: "/api/mcp/resource" },
  mcpResourceRead: { method: "GET", path: "/api/mcp/resource/:server" },

  ptyList: { method: "GET", path: "/api/pty" },
  ptyCreate: { method: "POST", path: "/api/pty" },
  ptyGet: { method: "GET", path: "/api/pty/:ptyID" },
  ptyUpdate: { method: "PUT", path: "/api/pty/:ptyID" },
  ptyRemove: { method: "DELETE", path: "/api/pty/:ptyID" },
  ptyInput: { method: "POST", path: "/api/pty/:ptyID/input" },
  ptyOutput: { method: "GET", path: "/api/pty/:ptyID/output" },
  ptyConnectToken: { method: "POST", path: "/api/pty/:ptyID/connect-token" },
  ptyConnect: { method: "GET", path: "/api/pty/:ptyID/connect", wire: "socket" },
  persistentPtyList: { method: "GET", path: "/api/experimental/session/:sessionID/terminal" },
  persistentPtyCreate: { method: "POST", path: "/api/experimental/session/:sessionID/terminal" },
  persistentPtyRead: { method: "GET", path: "/api/experimental/session/:sessionID/terminal/read" },
  persistentPtyShutdown: { method: "POST", path: "/api/experimental/persistent-pty/shutdown" },
  persistentPtyHandoff: { method: "POST", path: "/api/experimental/session/:sessionID/persistent-pty/handoff" },
  persistentPtyGet: { method: "GET", path: "/api/experimental/persistent-pty/:ptyID" },
  persistentPtyUpdate: { method: "PUT", path: "/api/experimental/persistent-pty/:ptyID" },
  persistentPtySnapshot: { method: "GET", path: "/api/experimental/persistent-pty/:ptyID/snapshot" },
  persistentPtyRemove: { method: "DELETE", path: "/api/experimental/persistent-pty/:ptyID" },
  persistentPtyConnectToken: { method: "POST", path: "/api/experimental/persistent-pty/:ptyID/connect-token" },
  persistentPtyConnect: { method: "GET", path: "/api/experimental/persistent-pty/:ptyID/connect", wire: "socket" },

  pluginList: { method: "GET", path: "/api/plugin" },
  pluginCheck: { method: "POST", path: "/api/plugin/check" },
  pluginUpdate: { method: "POST", path: "/api/plugin/update" },
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
  sessionEvents: { method: "GET", path: "/api/session/:sessionID/event", wire: "sse" },
  events: { method: "GET", path: "/api/event", wire: "sse" },
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

/** Response payload shapes, keyed by route. The SDK generates its return types from this map. */
export type JsonObject = Record<string, unknown>
export type FileEntry = { path: string; type: string }
export type PtyTicket = { ticket: string; expires_in: number }
export type PtyOutput = { data: string; offset: number }
export type PersistentPtyHandoff = { directory: string; instanceID: string; ticket: string; expiresAt: number }

export type NexusConfig = import("../cli/config").NexusConfig

export type RouteResponses = {
  info: { version: string; url: string; pid: number; startedAt: string; [key: string]: unknown }
  config: NexusConfig
  configUpdate: void
  providerVerify: { ok: boolean; error?: string }
  providers: JsonObject[]
  provider: JsonObject
  models: JsonObject[]
  modelDefault: JsonObject | null
  agents: JsonObject[]
  commands: JsonObject[]
  skills: JsonObject[]
  tools: JsonObject[]
  location: JsonObject
  locationReload: void
  debugLocations: Array<{ directory: string; model?: string }>
  debugEvict: void
  fsList: FileEntry[]
  fsRead: string
  fsFind: FileEntry[]
  fsWrite: { path: string }
  mcpList: JsonObject[]
  mcpAdd: void
  mcpRemove: void
  mcpConnect: void
  mcpDisconnect: void
  mcpResources: JsonObject
  mcpResourceRead: unknown
  ptyList: JsonObject[]
  ptyCreate: JsonObject
  ptyGet: JsonObject
  ptyUpdate: JsonObject
  ptyRemove: void
  ptyInput: void
  ptyOutput: PtyOutput
  ptyConnectToken: PtyTicket
  persistentPtyList: JsonObject[]
  persistentPtyCreate: JsonObject
  persistentPtyRead: JsonObject | null
  persistentPtyGet: JsonObject
  persistentPtyUpdate: JsonObject
  persistentPtyRemove: void
  persistentPtySnapshot: JsonObject
  persistentPtyShutdown: void
  persistentPtyHandoff: { handoff: PersistentPtyHandoff | null }
  persistentPtyConnectToken: PtyTicket
  pluginList: JsonObject[]
  pluginCheck: JsonObject[]
  pluginUpdate: JsonObject[]
  projectList: JsonObject[]
  projectUpdate: JsonObject
  referenceList: JsonObject[]
  formList: JsonObject[]
  generate: { text: string }
  sessions: unknown[]
  sessionCreate: JsonObject
  sessionImport: { session: JsonObject; imported: boolean }
  session: JsonObject
  sessionUpdate: void
  sessionDelete: void
  sessionRevert: JsonObject
  sessionFork: JsonObject
  sessionExport: JsonObject
  sessionUsage: JsonObject
  messages: unknown[]
  prompt: { cursor: number; queued?: boolean } & JsonObject
  interrupt: void
  permissions: unknown[]
  permissionReply: void
  questions: unknown[]
  questionReply: void
}

/** Routes without a declared response stay `unknown` until their shape is pinned. */
export type ResponseOf<N extends RouteName> = N extends keyof RouteResponses ? RouteResponses[N] : unknown

type AssertNever<T extends never> = T
export type _ResponseKeysAreRoutes = AssertNever<Exclude<keyof RouteResponses, RouteName>>

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
