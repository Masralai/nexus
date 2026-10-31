import type { NexusConfig } from "../cli/config"
import { hasResolvableKey, loadConfig } from "../cli/config"
import { advertiseTools, type AgentMode } from "../engine/mode"
import type { PermissionReply } from "../engine/permission"
import type { ImagePart, QuestionAnswer, ToolDefinition } from "../engine/types"
import { getModelInfo, listModels } from "../providers/catalog"
import { PRESETS, getPreset, type Preset } from "../providers/presets"
import { defaultTools } from "../tools"
import { authorized } from "./auth"
import { ROUTES, type RouteName } from "./contract"
import { ApiError, badRequest, notFound, unauthorized } from "./errors"
import type { SessionService, SessionView } from "./service"
import { eventStream } from "./sse"

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,x-nexus-token",
  "access-control-expose-headers": "x-nexus-token",
}

const SECRET_KEY = /(api[-_]?key|token|secret|password|authorization|cookie)/i

function redact(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (!value || typeof value !== "object") return value
  if (SECRET_KEY.test(key) || key === "headers" || key === "env") return "[redacted]"
  const out: Record<string, unknown> = {}
  for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
    out[name] = redact(item, name)
  }
  return out
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

function data<T>(value: T, status = 200): Response {
  return json({ data: value }, status)
}

function list<T>(value: T[]): Response {
  return json({ data: value, cursor: {} })
}

function noContent(): Response {
  return new Response(null, { status: 204 })
}

function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    const headers: Record<string, string> = {}
    if (error.status === 401) headers["www-authenticate"] = "Bearer"
    return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), {
      status: error.status,
      headers: { "content-type": "application/json; charset=utf-8", ...headers },
    })
  }
  const message = error instanceof Error ? error.message : String(error)
  return json({ error: { code: "internal", message } }, 500)
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function body(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text()
  if (!text.trim()) return {}
  if (text.length > 4_000_000) throw badRequest("request body is too large")
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw badRequest("invalid JSON body")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badRequest("JSON body must be an object")
  }
  return parsed as Record<string, unknown>
}

function stringField(input: Record<string, unknown>, key: string, required = true): string | undefined {
  const value = input[key]
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${key} is required`)
    return undefined
  }
  if (typeof value !== "string") throw badRequest(`${key} must be a string`)
  return value
}

function positiveInt(value: string | null, fallback: number, max = 500): number {
  if (value === null || value === "") return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) throw badRequest("limit must be a positive number")
  return Math.min(Math.floor(parsed), max)
}

function cursor(value: string | null): number {
  if (value === null || value === "") return 0
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw badRequest("after must be a non-negative cursor")
  return Math.floor(parsed)
}

function permissionReply(value: unknown): PermissionReply {
  if (value === true || value === "allow" || value === "once") return true
  if (value === "always") return "always"
  if (value === false || value === "deny" || value === "reject") return false
  throw badRequest("decision must be allow, deny, once, or always")
}

function providerInfo(preset: Preset, cfg: NexusConfig): Record<string, unknown> {
  const probe: NexusConfig = {
    ...cfg,
    preset: preset.id,
    provider: preset.adapter,
    baseUrl: preset.baseUrl,
  }
  return {
    id: preset.id,
    name: preset.label,
    adapter: preset.adapter,
    baseUrl: preset.baseUrl,
    models: preset.suggestedModels,
    requiresKey: preset.requiresKey,
    configured: preset.requiresKey ? hasResolvableKey(probe) : true,
  }
}

function agentList(cfg: NexusConfig): Array<Record<string, unknown>> {
  const builtins = (["build", "plan"] as const).map((mode) => ({
    id: mode,
    name: mode,
    mode,
    description: mode === "plan" ? "Read-only exploration and planning." : "Full tool access.",
    builtin: true,
  }))
  const custom = Object.entries(cfg.agents ?? {}).map(([id, agent]) => ({
    id,
    name: id,
    mode: agent.mode ?? "build",
    description: agent.description,
    model: agent.model,
    prompt: agent.prompt,
    tools: agent.tools,
    builtin: false,
  }))
  return [...builtins, ...custom]
}

function commandList(cfg: NexusConfig): Array<Record<string, unknown>> {
  return Object.entries(cfg.commands ?? {}).map(([name, command]) => {
    if (typeof command === "string") return { name, template: command }
    return {
      name,
      description: command.description,
      template: command.template,
      agent: command.agent,
      model: command.model,
    }
  })
}

function toolList(mode: AgentMode): ToolDefinition[] {
  return advertiseTools(new Map(defaultTools().map((tool) => [tool.name, tool])), mode)
}

function parseMode(value: string | null): AgentMode {
  if (value === null || value === "" || value === "build") return "build"
  if (value === "plan") return "plan"
  throw badRequest("mode must be plan or build")
}

export interface RouterInfo {
  version: string
  url: string
  pid: number
  startedAt: string
  [key: string]: unknown
}

export interface RouterOptions {
  service: SessionService
  token: string
  config?: NexusConfig
  info?: () => RouterInfo
}

type Handler = (input: {
  req: Request
  url: URL
  params: Record<string, string>
}) => Promise<Response> | Response

interface CompiledRoute {
  name: RouteName
  method: string
  segments: string[]
  handler: Handler
}

function match(pathname: string, pattern: string): Record<string, string> | undefined {
  const actual = pathname.replace(/\/+$/, "").split("/").filter(Boolean)
  const expected = pattern.split("/").filter(Boolean)
  if (actual.length !== expected.length) return undefined
  const params: Record<string, string> = {}
  for (let i = 0; i < expected.length; i++) {
    const part = expected[i]
    if (part.startsWith(":")) {
      params[part.slice(1)] = decodeURIComponent(actual[i])
    } else if (part !== actual[i]) {
      return undefined
    }
  }
  return params
}

/**
 * Build the request handler for the local API. The handler is deliberately
 * framework-free so tests can drive it through a real Bun server.
 */
export function createRouter(options: RouterOptions): (req: Request) => Promise<Response> {
  const cfg = options.config ?? loadConfig()
  const service = options.service

  const handlers: Record<RouteName, Handler> = {
    info: () =>
      data(
        options.info?.() ?? {
          version: "0.1.0",
          url: "",
          pid: process.pid,
          startedAt: new Date().toISOString(),
        },
      ),

    config: () => data(redact(cfg)),

    providers: () => data(PRESETS.map((preset) => providerInfo(preset, cfg))),

    provider: ({ params }) => {
      const preset = getPreset(params.providerID)
      if (!preset) throw notFound(`provider ${params.providerID} not found`)
      return data(providerInfo(preset, cfg))
    },

    models: () => data(listModels()),

    modelDefault: () => {
      if (!cfg.model) return data(null)
      return data(getModelInfo(cfg.model))
    },

    agents: () => data(agentList(cfg)),

    commands: () => data(commandList(cfg)),

    tools: ({ url }) => data(toolList(parseMode(url.searchParams.get("mode")))),

    sessions: ({ url }) => {
      const search = url.searchParams.get("search") ?? url.searchParams.get("q") ?? undefined
      const limit = positiveInt(url.searchParams.get("limit"), 50)
      return list<SessionView>(service.list(search || undefined, limit))
    },

    sessionCreate: async ({ req }) => {
      const input = await body(req)
      const cwd = stringField(input, "cwd", false)
      const model = stringField(input, "model", false)
      const provider = stringField(input, "provider", false)
      const title = stringField(input, "title", false)
      return data(
        service.create({
          ...(cwd ? { cwd } : {}),
          ...(model ? { model } : {}),
          ...(provider ? { provider } : {}),
          ...(title ? { title } : {}),
        }),
        201,
      )
    },

    sessionImport: async ({ req }) => {
      const result = service.importSession(await body(req))
      return data(result, result.imported ? 201 : 200)
    },

    session: ({ params }) => data(service.get(params.sessionID)),

    sessionRevert: async ({ req, params }) => {
      const input = await body(req)
      const messageID = stringField(input, "messageID", false)
      return data(service.revert(params.sessionID, messageID))
    },

    sessionFork: async ({ req, params }) => {
      const input = await body(req)
      const messageID = stringField(input, "messageID", false)
      const title = stringField(input, "title", false)
      return data(service.fork(params.sessionID, messageID, title), 201)
    },

    sessionExport: ({ params }) => data(service.exportSession(params.sessionID)),

    sessionUsage: ({ params }) => data(service.usage(params.sessionID)),

    sessionUpdate: async ({ req, params }) => {
      const input = await body(req)
      const title = stringField(input, "title")
      service.rename(params.sessionID, title!)
      return noContent()
    },

    sessionDelete: ({ params }) => {
      service.remove(params.sessionID)
      return noContent()
    },

    messages: ({ url, params }) => {
      const limit = positiveInt(url.searchParams.get("limit"), 0, 10_000)
      return list(service.messages(params.sessionID, limit || undefined))
    },

    prompt: async ({ req, params }) => {
      const input = await body(req)
      const text = stringField(input, "text")
      const images = input.images
      if (images !== undefined && !Array.isArray(images)) throw badRequest("images must be an array")
      const autoApprove = input.autoApprove === true || input.yes === true
      const modeRaw = stringField(input, "mode", false)
      const mode = modeRaw ? parseMode(modeRaw) : undefined
      const result = service.prompt(params.sessionID, {
        text: text!,
        ...(images ? { images: images as ImagePart[] } : {}),
        ...(autoApprove ? { autoApprove: true } : {}),
        ...(mode ? { mode } : {}),
      })
      return data(result.message, result.queued ? 202 : 200)
    },

    interrupt: ({ params }) => {
      service.interrupt(params.sessionID)
      return noContent()
    },

    permissions: ({ params }) => data(service.pendingPermissions(params.sessionID)),

    permissionReply: async ({ req, params }) => {
      const input = await body(req)
      const decision = permissionReply(input.decision ?? input.reply)
      service.replyPermission(params.sessionID, params.requestID, decision)
      return noContent()
    },

    questions: ({ params }) => data(service.pendingQuestions(params.sessionID)),

    questionReply: async ({ req, params }) => {
      const input = await body(req)
      if (!Array.isArray(input.answers)) throw badRequest("answers must be an array")
      for (const answer of input.answers) {
        if (
          !answer ||
          typeof answer !== "object" ||
          typeof (answer as QuestionAnswer).header !== "string" ||
          typeof (answer as QuestionAnswer).question !== "string" ||
          typeof (answer as QuestionAnswer).answer !== "string"
        ) {
          throw badRequest("each answer requires header, question, and answer strings")
        }
      }
      service.replyQuestion(params.sessionID, params.requestID, input.answers as QuestionAnswer[])
      return noContent()
    },

    sessionEvents: ({ req, url, params }) => {
      return eventStream({
        initial: service.eventsAfter(params.sessionID, cursor(url.searchParams.get("after"))),
        follow: true,
        signal: req.signal,
        subscribe: service.subscribe.bind(service),
        sessionID: params.sessionID,
      })
    },

    events: ({ req, url }) => {
      return eventStream({
        initial: service.allEventsAfter(cursor(url.searchParams.get("after"))),
        follow: true,
        signal: req.signal,
        subscribe: service.subscribe.bind(service),
      })
    },
  }

  const routes: CompiledRoute[] = (Object.entries(ROUTES) as Array<[RouteName, { method: string; path: string }]>).map(
    ([name, definition]) => ({
      name,
      method: definition.method,
      segments: definition.path.split("/").filter(Boolean),
      handler: handlers[name],
    }),
  )

  return async (req: Request): Promise<Response> => {
    try {
      if (req.method === "OPTIONS") return withCors(noContent())

      const url = new URL(req.url)
      if (!authorized(req, url, options.token)) return withCors(errorResponse(unauthorized()))

      const path = url.pathname.replace(/\/+$/, "") || "/"
      let pathMatched = false
      for (const route of routes) {
        const params = match(path, `/${route.segments.join("/")}`)
        if (!params) continue
        pathMatched = true
        if (route.method !== req.method) continue
        return withCors(await route.handler({ req, url, params }))
      }

      if (pathMatched) {
        throw new ApiError(405, "method_not_allowed", `${req.method} is not allowed for ${path}`)
      }
      throw notFound(`route ${path} not found`)
    } catch (error) {
      return withCors(errorResponse(error))
    }
  }
}
