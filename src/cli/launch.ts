import { randomUUID } from "node:crypto"
import { run, type RunConfig } from "../engine/loop"
import type { AgentMode } from "../engine/mode"
import { pathForCall, reasonForCall } from "../engine/permission"
import type { SQLiteStore } from "../engine/sqlite"
import { openSessionStore, type SessionStore } from "../engine/store"
import type {
  EngineEvent,
  JobControl,
  LspControl,
  McpControl,
  Message,
  PermissionAuditRecord,
  PtyControl,
  SavedPermissionRecord,
  SnapshotStore,
  Tool,
  WorktreeControl,
} from "../engine/types"
import { EventBus } from "../engine/bus"
import { loadPlugins } from "../plugins/load"
import { PluginRegistry } from "../plugins/hooks"
import { createProvider } from "../providers"
import type { Provider } from "../providers/types"
import type { Skill } from "../skills"
import { defaultTools } from "../tools"
import { createAfterEdit } from "../runtime/hooks"
import { JobManager } from "../runtime/jobs"
import { LspManager } from "../runtime/lsp"
import { McpManager, mcpAsTools } from "../runtime/mcp"
import { PtyManager } from "../runtime/pty"
import { WorktreeManager } from "../runtime/worktree"
import { defaultCompactModel, loadConfig, resolveApiKey, type NexusConfig } from "./config"

/** Long-lived runtime services shared by every Turn in one workspace/model. */
export interface RuntimeControls {
  pty: PtyControl
  lsp: LspControl
  mcp: McpControl
  jobs?: JobControl
  worktree?: WorktreeControl
  afterEdit?: (paths: string[]) => Promise<string[]>
}

export interface Runtime {
  cfg: NexusConfig
  provider: Provider
  compactProvider: Provider
  /** Cheap provider for generated Session titles; falls back to compactModel. */
  titleProvider?: Provider
  registry: Map<string, Tool>
  store: SessionStore
  bus?: EventBus<EngineEvent>
  plugins?: PluginRegistry
  readonly pluginErrors?: Array<{ path: string; message: string }>
  controls?: RuntimeControls
  /** Connect lazily configured integrations and register their tools. Idempotent. */
  ready?(): Promise<void>
  /** Release shells, language servers, background jobs, and MCP clients. */
  close?(): Promise<void>
}

export interface LaunchOpts {
  model?: string
  store?: SessionStore
  tools?: Tool[]
  cwd?: string
  plugins?: PluginRegistry
}

interface PermissionStore {
  ensureProject(worktree: string): { id: string }
  listPermissions(projectId?: string): SavedPermissionRecord[]
  savePermission(record: Omit<SavedPermissionRecord, "id" | "createdAt"> & { id?: string }): SavedPermissionRecord
  auditPermission(record: Omit<PermissionAuditRecord, "id" | "createdAt">): PermissionAuditRecord
}

function permissionStore(store: SessionStore): PermissionStore | undefined {
  const candidate = store as unknown as Partial<PermissionStore>
  return typeof candidate.ensureProject === "function" &&
    typeof candidate.listPermissions === "function" &&
    typeof candidate.savePermission === "function" &&
    typeof candidate.auditPermission === "function"
    ? (candidate as PermissionStore)
    : undefined
}

function snapshotStore(store: SessionStore): SnapshotStore | undefined {
  const candidate = store as unknown as Partial<SnapshotStore>
  return typeof candidate.saveSnapshot === "function" && typeof candidate.getSnapshot === "function"
    ? (candidate as SnapshotStore)
    : undefined
}

interface PendingStore {
  takePending(sessionId: string, kind?: string): Array<{ kind: string; data: unknown }>
}

/** Queued user input for steering, read atomically between provider calls. */
function pendingInput(store: SessionStore, sessionId: string): Message[] {
  const candidate = store as unknown as Partial<PendingStore>
  if (typeof candidate.takePending !== "function") return []
  return candidate
    .takePending(sessionId, "prompt")
    .map((item) => (item.data as { message?: Message }).message)
    .filter((message): message is Message => message?.role === "user")
}

/** Resolve the tools that make up a default registry. */
function buildRegistry(tools: Tool[]): Map<string, Tool> {
  return new Map(tools.map((t) => [t.name, t]))
}

function closeIfAvailable(target: unknown): void {
  const close = (target as { close?: () => unknown } | undefined)?.close
  if (typeof close !== "function") return
  try {
    void close.call(target)
  } catch {
    /* teardown is best effort */
  }
}

/** Turn launcher: provider, compact provider, tool registry, config, store. */
export function launchRuntime(opts: LaunchOpts = {}): Runtime {
  const cwd = opts.cwd ?? process.cwd()
  const cfg = loadConfig({ model: opts.model, cwd })
  const plugins = opts.plugins ?? new PluginRegistry()
  // BYOK resolution wins; plugins may supply an auth method as a fallback.
  const apiKey = resolveApiKey(cfg) ?? plugins.auth(cfg.provider)?.apiKey
  const common = {
    provider: cfg.provider,
    apiKey,
    baseUrl: cfg.baseUrl,
  }
  const store = opts.store ?? openSessionStore()
  const baseTools = opts.tools ?? defaultTools()
  const registry = new Map<string, Tool>()
  const rebuildRegistry = (): void => {
    registry.clear()
    for (const [name, tool] of buildRegistry(plugins.tools(baseTools, { cwd }))) registry.set(name, tool)
  }
  rebuildRegistry()

  const jobs =
    typeof (store as unknown as { createJob?: unknown }).createJob === "function"
      ? new JobManager(store as unknown as SQLiteStore)
      : undefined
  const afterEdit = createAfterEdit(cfg, cwd)
  const controls: RuntimeControls = {
    pty: new PtyManager(),
    lsp: new LspManager(cfg.lsp ?? {}, cwd),
    mcp: new McpManager(cfg.mcp ?? {}, cwd),
    worktree: new WorktreeManager(cwd, store as unknown as { recordWorktree?: (directory: string, strategy?: string) => void; forgetWorktree?: (directory: string) => void }),
    ...(jobs ? { jobs } : {}),
    ...(afterEdit ? { afterEdit } : {}),
  }

  let readyPromise: Promise<void> | undefined
  let pluginErrors: Array<{ path: string; message: string }> = []
  const compactModel = cfg.compactModel || defaultCompactModel(cfg.preset, cfg.provider, cfg.model)
  return {
    cfg,
    provider: createProvider({ ...common, model: cfg.model }),
    compactProvider: createProvider({ ...common, model: compactModel }),
    titleProvider: createProvider({ ...common, model: cfg.titleModel || compactModel }),
    registry,
    store,
    bus: new EventBus<EngineEvent>(),
    plugins,
    controls,
    get pluginErrors() {
      return pluginErrors
    },
    ready() {
      if (readyPromise) return readyPromise
      readyPromise = (async () => {
        if (!opts.plugins && cfg.plugins?.length) {
          const loaded = await loadPlugins(cfg.plugins, { cwd, registry: plugins })
          pluginErrors = loaded.errors
          rebuildRegistry()
        }
        if (Object.keys(cfg.mcp ?? {}).length === 0) return
        // A slow or broken server must never block the first Turn.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 10_000)
          controls.mcp
            .connect()
            .catch(() => undefined)
            .finally(() => {
              clearTimeout(timer)
              resolve()
            })
        })
        for (const tool of mcpAsTools(controls.mcp)) {
          if (!registry.has(tool.name)) registry.set(tool.name, tool)
        }
      })()
      return readyPromise
    },
    async close() {
      try {
        controls.pty.close()
      } catch {
        /* already closed */
      }
      closeIfAvailable(controls.lsp)
      closeIfAvailable(controls.jobs)
      if (controls.mcp) await Promise.resolve(controls.mcp.close()).catch(() => undefined)
    },
  }
}

export interface TurnOpts {
  messages: Message[]
  cwd?: string
  sessionId?: string
  resume?: boolean
  mode?: AgentMode
  skills?: Skill[]
  /** Custom agent selected for this Turn. */
  agent?: RunConfig["agent"]
  autoApprove?: boolean
  /** In unattended runs, refuse paths outside cwd unless explicitly allowed. */
  workspaceBoundary?: boolean
  signal?: AbortSignal
  askPermission?: RunConfig["askPermission"]
  askQuestion?: RunConfig["askQuestion"]
  savedPermission?: RunConfig["savedPermission"]
  onPermissionAlways?: RunConfig["onPermissionAlways"]
  snapshotStore?: SnapshotStore
  runtime?: Runtime
  model?: string
  maxSteps?: number
  compactThreshold?: number
}

/** Start a Turn via the launcher seam. */
export async function* runTurn(opts: TurnOpts): AsyncIterable<EngineEvent> {
  const cwd = opts.cwd ?? process.cwd()
  const rt = opts.runtime ?? launchRuntime({ model: opts.model, cwd })
  const sessionId = opts.sessionId ?? randomUUID()
  const pluginCtx = { cwd, sessionId }
  await rt.ready?.()
  const providerParams = rt.plugins?.chatParams({}, pluginCtx)

  const perms = permissionStore(rt.store)
  let projectId: string | undefined
  const project = (): string | undefined => {
    if (!perms) return undefined
    if (projectId === undefined) {
      try {
        projectId = perms.ensureProject(cwd).id
      } catch {
        projectId = ""
      }
    }
    return projectId || undefined
  }
  const permissionTarget = (name: string, input: unknown): string => pathForCall(name, input) ?? reasonForCall(name, input)

  const savedPermission: RunConfig["savedPermission"] =
    opts.savedPermission ??
    (perms
      ? (name, input) => {
          const id = project()
          if (!id) return undefined
          const target = permissionTarget(name, input)
          let action: SavedPermissionRecord["action"] | undefined
          for (const record of perms.listPermissions(id)) {
            if (record.tool !== name) continue
            if (record.pattern && record.pattern !== target) continue
            action = record.action
          }
          return action === "allow" || action === "deny" ? action : undefined
        }
      : undefined)

  const onPermissionAlways: RunConfig["onPermissionAlways"] =
    opts.onPermissionAlways ??
    (perms
      ? (req) => {
          const id = project()
          if (!id) return
          perms.savePermission({
            projectId: id,
            tool: req.name,
            pattern: permissionTarget(req.name, req.input),
            action: "allow",
          })
        }
      : undefined)

  const events = run(opts.messages, {
    provider: rt.provider,
    registry: rt.registry,
    cwd,
    model: opts.model ?? (rt.cfg.model || "(default)"),
    maxSteps: opts.maxSteps ?? rt.cfg.maxSteps,
    store: rt.store,
    sessionId,
    signal: opts.signal,
    autoApprove: opts.autoApprove,
    workspaceBoundary: opts.workspaceBoundary ?? rt.cfg.workspaceBoundary,
    resume: opts.resume,
    pendingInput: () => pendingInput(rt.store, sessionId),
    mode: opts.mode,
    skills: opts.skills,
    agent: opts.agent,
    compactProvider: rt.compactProvider,
    compactThreshold: opts.compactThreshold ?? rt.cfg.compactThreshold,
    providerParams,
    snapshotStore: opts.snapshotStore ?? snapshotStore(rt.store),
    jobs: rt.controls?.jobs,
    pty: rt.controls?.pty,
    lsp: rt.controls?.lsp,
    mcp: rt.controls?.mcp,
    worktree: rt.controls?.worktree,
    afterEdit: rt.controls?.afterEdit,
    savedPermission,
    onPermissionAlways,
    onPermission: (req) => {
      rt.plugins?.permission(req, pluginCtx)
      if (!perms) return
      try {
        perms.auditPermission({
          sessionId,
          tool: req.name,
          input: req.input,
          action: (req.action as PermissionAuditRecord["action"]) ?? (req.granted ? "allow" : "deny"),
          source: req.source ?? "policy",
        })
      } catch {
        /* auditing must never fail a turn */
      }
    },
    askPermission: opts.askPermission,
    askQuestion: opts.askQuestion,
    rules: rt.cfg.permission,
    instructionPaths: rt.cfg.instructions,
  })
  for await (const event of events) {
    rt.bus?.publish(event)
    rt.plugins?.emit(event, pluginCtx)
    yield event
  }
}
