import { randomUUID } from "node:crypto"
import { run, type RunConfig } from "../engine/loop"
import type { AgentMode } from "../engine/mode"
import { openSessionStore, type SessionStore } from "../engine/store"
import type { EngineEvent, Message, Tool } from "../engine/types"
import { EventBus } from "../engine/bus"
import { PluginRegistry } from "../plugins/hooks"
import { createProvider } from "../providers"
import type { Provider } from "../providers/types"
import type { Skill } from "../skills"
import { defaultTools } from "../tools"
import { defaultCompactModel, loadConfig, resolveApiKey, type NexusConfig } from "./config"

export interface Runtime {
  cfg: NexusConfig
  provider: Provider
  compactProvider: Provider
  registry: Map<string, Tool>
  store: SessionStore
  bus?: EventBus<EngineEvent>
  plugins?: PluginRegistry
}

export interface LaunchOpts {
  model?: string
  store?: SessionStore
  tools?: Tool[]
  cwd?: string
  plugins?: PluginRegistry
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
  const tools = plugins.tools(opts.tools ?? defaultTools(), { cwd })
  return {
    cfg,
    provider: createProvider({ ...common, model: cfg.model }),
    compactProvider: createProvider({
      ...common,
      model: cfg.compactModel || defaultCompactModel(cfg.preset, cfg.provider, cfg.model),
    }),
    registry: new Map(tools.map((t) => [t.name, t])),
    store: opts.store ?? openSessionStore(),
    bus: new EventBus<EngineEvent>(),
    plugins,
  }
}

export interface TurnOpts {
  messages: Message[]
  cwd?: string
  sessionId?: string
  resume?: boolean
  mode?: AgentMode
  skills?: Skill[]
  autoApprove?: boolean
  signal?: AbortSignal
  askPermission?: RunConfig["askPermission"]
  askQuestion?: RunConfig["askQuestion"]
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
  const providerParams = rt.plugins?.chatParams({}, pluginCtx)
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
    resume: opts.resume,
    mode: opts.mode,
    skills: opts.skills,
    compactProvider: rt.compactProvider,
    compactThreshold: opts.compactThreshold ?? rt.cfg.compactThreshold,
    providerParams,
    onPermission: rt.plugins ? (req) => rt.plugins!.permission(req, pluginCtx) : undefined,
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
