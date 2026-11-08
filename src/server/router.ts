import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type { NexusConfig } from "../cli/config"
import { hasResolvableKey, loadConfig } from "../cli/config"
import { advertiseTools, type AgentMode } from "../engine/mode"
import type { PermissionReply } from "../engine/permission"
import type { ImagePart, PtyCreateOptions, PtyInfo, QuestionAnswer, ToolDefinition } from "../engine/types"
import { getModelInfo, listModels } from "../providers/catalog"
import { PRESETS, getPreset, type Preset } from "../providers/presets"
import { defaultTools } from "../tools"
import { allFiles } from "../tools/walk"
import { authorized } from "./auth"
import { ROUTES, type RouteName } from "./contract"
import { ApiError, badGateway, badRequest, notFound, unavailable, unauthorized } from "./errors"
import type { SessionService, SessionView } from "./service"
import { eventStream } from "./sse"

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
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

function locationDirectory(url: URL, fallback: string): string {
  const value =
    url.searchParams.get("location[directory]") ??
    url.searchParams.get("directory") ??
    url.searchParams.get("location") ??
    "."
  return resolve(fallback, value)
}

function located(directory: string, value: unknown, status = 200): Response {
  return json({ location: { directory }, data: value }, status)
}

function stringArray(input: Record<string, unknown>, key: string): string[] | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw badRequest(`${key} must be an array of strings`)
  }
  return value as string[]
}

function stringMap(input: Record<string, unknown>, key: string): Record<string, string> | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badRequest(`${key} must be an object`)
  for (const item of Object.values(value)) {
    if (typeof item !== "string") throw badRequest(`${key} values must be strings`)
  }
  return value as Record<string, string>
}

function fsEntryPath(base: string, full: string): string {
  return relative(base, full).split(sep).join("/")
}

function listDirectory(base: string, path?: string): Array<{ path: string; type: "file" | "directory" }> {
  const dir = resolve(base, path ?? ".")
  if (!existsSync(dir)) throw notFound(`directory ${dir} not found`)
  if (!statSync(dir).isDirectory()) throw badRequest(`not a directory: ${dir}`)
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.name !== ".git")
    .map((entry) => ({
      path: fsEntryPath(base, join(dir, entry.name)),
      type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
    }))
    .filter((entry) => entry.type === "file" || entry.type === "directory")
}

function walkDirectories(root: string, out: string[] = [], relativePath = ""): string[] {
  if (out.length >= 50_000) return out
  let entries
  try {
    entries = readdirSync(join(root, relativePath), { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue
    const next = relativePath ? `${relativePath}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      out.push(next)
      walkDirectories(root, out, next)
    }
  }
  return out
}

function findEntries(
  base: string,
  query: string,
  type: "file" | "directory" | undefined,
  limit: number,
): Array<{ path: string; type: "file" | "directory" }> {
  const files = type === "directory" ? [] : allFiles(base)
  const dirs = type === "file" ? [] : walkDirectories(base)
  const needle = query.toLowerCase()
  return [
    ...files.map((path) => ({ path, type: "file" as const })),
    ...dirs.map((path) => ({ path, type: "directory" as const })),
  ]
    .filter((entry) => !needle || entry.path.toLowerCase().includes(needle))
    .slice(0, limit)
}

type ManagedPty = {
  list(): PtyInfo[]
  create(id: string, opts?: PtyCreateOptions): PtyInfo
  get(id: string): PtyInfo | undefined
  update(id: string, opts: { title?: string; rows?: number; cols?: number }): PtyInfo
  write(id: string, data: string): void
  output(id: string, offset?: number): { data: string; offset: number }
  remove(id: string): void
}

function managedPty(service: SessionService): ManagedPty {
  const pty = service.defaultWorkspace().controls?.pty as Partial<ManagedPty> | undefined
  if (
    !pty ||
    typeof pty.list !== "function" ||
    typeof pty.create !== "function" ||
    typeof pty.get !== "function" ||
    typeof pty.update !== "function" ||
    typeof pty.write !== "function" ||
    typeof pty.output !== "function" ||
    typeof pty.remove !== "function"
  ) {
    throw unavailable("PTY control is unavailable")
  }
  return pty as ManagedPty
}

function projectView(project: {
  id: string
  worktree: string
  vcs?: string
  name?: string
  icon?: Record<string, unknown>
  commands?: Record<string, unknown>
  updatedAt: string
}): Record<string, unknown> {
  return {
    id: project.id,
    canonical: project.worktree,
    name: project.name ?? basename(project.worktree),
    ...(project.vcs ? { vcs: project.vcs } : {}),
    ...(project.icon ? { icon: project.icon } : {}),
    ...(project.commands ? { commands: project.commands } : {}),
    time: { created: project.updatedAt, updated: project.updatedAt },
    sandboxes: [],
  }
}

function referenceList(cfg: NexusConfig, base: string): Array<Record<string, unknown>> {
  return (cfg.instructions ?? [])
    .filter((path) => !/^https?:\/\//i.test(path))
    .map((path) => {
      const full = resolve(base, path)
      return { name: basename(full), path: full, source: { type: "local", path: full } }
    })
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
  defaultCwd?: string
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
  const params: Record<string, string> = {}
  for (let i = 0; i < expected.length; i++) {
    const part = expected[i]
    if (part === "*") {
      params["*"] = actual.slice(i).map(decodeURIComponent).join("/")
      return params
    }
    if (actual[i] === undefined) return undefined
    if (part.startsWith(":")) {
      params[part.slice(1)] = decodeURIComponent(actual[i])
    } else if (part !== actual[i]) {
      return undefined
    }
  }
  return actual.length === expected.length ? params : undefined
}

/**
 * Build the request handler for the local API. The handler is deliberately
 * framework-free so tests can drive it through a real Bun server.
 */
export function createRouter(options: RouterOptions): (req: Request) => Promise<Response> {
  const cfg = options.config ?? loadConfig()
  const service = options.service
  const defaultCwd = options.defaultCwd ?? process.cwd()

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

    location: ({ url }) => {
      const directory = locationDirectory(url, defaultCwd)
      const project = service.projectFor(directory)
      return data({
        directory,
        project: { id: project.id, directory: project.directory, canonical: project.canonical },
      })
    },

    locationReload: async () => {
      await service.reloadWorkspaces()
      return noContent()
    },

    debugLocations: () => data(service.workspaces()),

    debugEvict: ({ url }) => {
      service.evictWorkspace(locationDirectory(url, defaultCwd), url.searchParams.get("model") ?? undefined)
      return noContent()
    },

    fsList: ({ url }) => {
      const base = locationDirectory(url, defaultCwd)
      return located(base, listDirectory(base, url.searchParams.get("path") ?? undefined))
    },

    fsRead: ({ url, params }) => {
      const base = locationDirectory(url, defaultCwd)
      const full = resolve(base, params["*"] ?? "")
      if (!existsSync(full)) throw notFound(`file ${full} not found`)
      if (!statSync(full).isFile()) throw badRequest(`not a file: ${full}`)
      return new Response(Bun.file(full), { headers: { "cache-control": "no-store" } })
    },

    fsFind: ({ url }) => {
      const base = locationDirectory(url, defaultCwd)
      const query = url.searchParams.get("query")
      if (query === null) throw badRequest("query is required")
      const typeRaw = url.searchParams.get("type")
      if (typeRaw !== null && typeRaw !== "file" && typeRaw !== "directory") {
        throw badRequest("type must be file or directory")
      }
      const limit = positiveInt(url.searchParams.get("limit"), 200, 10_000)
      return located(base, findEntries(base, query, typeRaw ?? undefined, limit))
    },

    fsWrite: async ({ req, url }) => {
      const base = locationDirectory(url, defaultCwd)
      const path = url.searchParams.get("path")
      if (!path) throw badRequest("path is required")
      const full = isAbsolute(path) ? path : resolve(base, path)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, await req.text())
      return located(base, { path: full })
    },

    mcpList: ({ url }) => {
      const directory = locationDirectory(url, defaultCwd)
      const mcp = service.workspace(directory).controls?.mcp
      if (!mcp) throw unavailable("MCP control is unavailable")
      const servers = mcp.status().map((server) => ({
        name: server.name,
        status: server.connected
          ? { status: "connected" }
          : server.error
            ? { status: "failed", error: server.error }
            : { status: "pending" },
      }))
      return located(directory, servers)
    },

    mcpAdd: async ({ req, url, params }) => {
      const directory = locationDirectory(url, defaultCwd)
      const mcp = service.workspace(directory).controls?.mcp
      if (!mcp?.add) throw unavailable("MCP control is unavailable")
      const input = await body(req)
      const config = input.config
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw badRequest("config must be an object")
      }
      try {
        await mcp.add(params.server, config)
      } catch (error) {
        throw badGateway(error instanceof Error ? error.message : String(error))
      }
      return noContent()
    },

    mcpRemove: async ({ url, params }) => {
      const directory = locationDirectory(url, defaultCwd)
      const mcp = service.workspace(directory).controls?.mcp
      if (!mcp?.remove) throw unavailable("MCP control is unavailable")
      if (!mcp.status().some((server) => server.name === params.server)) {
        throw notFound(`MCP server ${params.server} not found`)
      }
      try {
        await mcp.remove(params.server)
      } catch (error) {
        throw badGateway(error instanceof Error ? error.message : String(error))
      }
      return noContent()
    },

    mcpConnect: async ({ url, params }) => {
      const directory = locationDirectory(url, defaultCwd)
      const mcp = service.workspace(directory).controls?.mcp
      if (!mcp) throw unavailable("MCP control is unavailable")
      if (!mcp.status().some((server) => server.name === params.server)) {
        throw notFound(`MCP server ${params.server} not found`)
      }
      try {
        await mcp.connect(params.server)
      } catch (error) {
        throw badGateway(error instanceof Error ? error.message : String(error))
      }
      return noContent()
    },

    mcpDisconnect: async ({ url, params }) => {
      const directory = locationDirectory(url, defaultCwd)
      const mcp = service.workspace(directory).controls?.mcp
      if (!mcp) throw unavailable("MCP control is unavailable")
      if (!mcp.status().some((server) => server.name === params.server)) {
        throw notFound(`MCP server ${params.server} not found`)
      }
      try {
        await mcp.disconnect(params.server)
      } catch (error) {
        throw badGateway(error instanceof Error ? error.message : String(error))
      }
      return noContent()
    },

    mcpResources: async ({ url }) => {
      const directory = locationDirectory(url, defaultCwd)
      const mcp = service.workspace(directory).controls?.mcp
      if (!mcp) throw unavailable("MCP control is unavailable")
      return located(directory, { resources: await mcp.resources(), templates: [] })
    },

    ptyList: ({ url }) => located(locationDirectory(url, defaultCwd), managedPty(service).list()),

    ptyCreate: async ({ req, url }) => {
      const base = locationDirectory(url, defaultCwd)
      const input = await body(req)
      const cwd = stringField(input, "cwd", false)
      const command = stringField(input, "command", false)
      const title = stringField(input, "title", false)
      const args = stringArray(input, "args")
      const env = stringMap(input, "env")
      const info = managedPty(service).create(`pty_${randomUUID()}`, {
        cwd: resolve(base, cwd ?? "."),
        ...(command ? { command } : {}),
        ...(args ? { args } : {}),
        ...(title ? { title } : {}),
        ...(env ? { env } : {}),
      })
      return located(base, info, 201)
    },

    ptyGet: ({ url, params }) => {
      const base = locationDirectory(url, defaultCwd)
      const info = managedPty(service).get(params.ptyID)
      if (!info) throw notFound(`pty ${params.ptyID} not found`)
      return located(base, info)
    },

    ptyUpdate: async ({ req, url, params }) => {
      const base = locationDirectory(url, defaultCwd)
      const input = await body(req)
      const title = stringField(input, "title", false)
      const size = input.size as { rows?: unknown; cols?: unknown } | undefined
      if (size !== undefined && (!size || typeof size !== "object")) throw badRequest("size must be an object")
      const rows = typeof size?.rows === "number" && size.rows > 0 ? Math.floor(size.rows) : undefined
      const cols = typeof size?.cols === "number" && size.cols > 0 ? Math.floor(size.cols) : undefined
      try {
        return located(base, managedPty(service).update(params.ptyID, { ...(title ? { title } : {}), rows, cols }))
      } catch (error) {
        if (/not found/.test(error instanceof Error ? error.message : "")) throw notFound(`pty ${params.ptyID} not found`)
        throw error
      }
    },

    ptyRemove: ({ params }) => {
      const control = managedPty(service)
      if (!control.get(params.ptyID)) throw notFound(`pty ${params.ptyID} not found`)
      control.remove(params.ptyID)
      return noContent()
    },

    ptyInput: async ({ req, params }) => {
      const input = await body(req)
      const data = stringField(input, "data")
      try {
        managedPty(service).write(params.ptyID, data!)
      } catch (error) {
        if (/not found|not running/.test(error instanceof Error ? error.message : "")) {
          throw notFound(`pty ${params.ptyID} not found or exited`)
        }
        throw error
      }
      return noContent()
    },

    ptyOutput: ({ url, params }) => {
      const base = locationDirectory(url, defaultCwd)
      try {
        return located(base, managedPty(service).output(params.ptyID, cursor(url.searchParams.get("offset"))))
      } catch (error) {
        if (/not found/.test(error instanceof Error ? error.message : "")) throw notFound(`pty ${params.ptyID} not found`)
        throw error
      }
    },

    persistentPtyList: ({ params }) => {
      const info = managedPty(service).get(`terminal_${params.sessionID}`)
      return data(info ? [info] : [])
    },

    persistentPtyCreate: async ({ req, params }) => {
      const session = service.get(params.sessionID)
      const input = await body(req)
      const command = stringField(input, "command", false)
      const title = stringField(input, "title", false)
      const args = stringArray(input, "args")
      const env = stringMap(input, "env")
      const info = managedPty(service).create(`terminal_${params.sessionID}`, {
        cwd: session.cwd,
        ...(command ? { command } : {}),
        ...(args ? { args } : {}),
        ...(title ? { title } : {}),
        ...(env ? { env } : {}),
      })
      return data(info, 201)
    },

    persistentPtyGet: ({ params }) => {
      const info = managedPty(service).get(params.ptyID)
      if (!info) throw notFound(`pty ${params.ptyID} not found`)
      return data(info)
    },

    persistentPtyRemove: ({ params }) => {
      const control = managedPty(service)
      if (!control.get(params.ptyID)) throw notFound(`pty ${params.ptyID} not found`)
      control.remove(params.ptyID)
      return noContent()
    },

    pluginList: ({ url }) => data(service.pluginInfo(locationDirectory(url, defaultCwd))),

    projectList: () => data(service.listProjects().map(projectView)),

    projectUpdate: async ({ req, params }) => {
      const input = await body(req)
      const canonical = stringField(input, "canonical", false)
      const name = stringField(input, "name", false)
      const iconRaw = input.icon
      const commandsRaw = input.commands
      if (iconRaw !== undefined && (!iconRaw || typeof iconRaw !== "object" || Array.isArray(iconRaw))) {
        throw badRequest("icon must be an object")
      }
      if (
        commandsRaw !== undefined &&
        (!commandsRaw || typeof commandsRaw !== "object" || Array.isArray(commandsRaw))
      ) {
        throw badRequest("commands must be an object")
      }
      if (canonical === undefined && name === undefined && iconRaw === undefined && commandsRaw === undefined) {
        throw badRequest("canonical, name, icon, or commands is required")
      }
      return data(
        projectView(
          service.updateProject(params.projectID, {
            ...(canonical !== undefined ? { canonical } : {}),
            ...(name !== undefined ? { name } : {}),
            ...(iconRaw !== undefined ? { icon: iconRaw as Record<string, unknown> } : {}),
            ...(commandsRaw !== undefined ? { commands: commandsRaw as Record<string, unknown> } : {}),
          }),
        ),
      )
    },

    referenceList: ({ url }) => data(referenceList(cfg, locationDirectory(url, defaultCwd))),

    formList: () => data(service.pendingForms()),

    generate: async ({ req }) => {
      const input = await body(req)
      const prompt = stringField(input, "prompt")
      const model = stringField(input, "model", false)
      return data({ text: await service.generate({ prompt: prompt!, ...(model ? { model } : {}) }) })
    },

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
      const title = stringField(input, "title", false)
      const model = stringField(input, "model", false)
      const provider = stringField(input, "provider", false)
      if (title === undefined && model === undefined && provider === undefined) {
        throw badRequest("title, model, or provider is required")
      }
      service.update(params.sessionID, {
        ...(title !== undefined ? { title } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(provider !== undefined ? { provider } : {}),
      })
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
