import { randomUUID } from "node:crypto"
import { run, type RunConfig } from "../engine/loop"
import type { AgentMode } from "../engine/mode"
import { JSONLStore } from "../engine/state"
import type { EngineEvent, Message, Tool } from "../engine/types"
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
  store: JSONLStore
}

export interface LaunchOpts {
  model?: string
  store?: JSONLStore
  tools?: Tool[]
}

/** Turn launcher: provider, compact provider, tool registry, config, store. */
export function launchRuntime(opts: LaunchOpts = {}): Runtime {
  const cfg = loadConfig({ model: opts.model })
  const apiKey = resolveApiKey(cfg)
  const common = {
    provider: cfg.provider,
    apiKey,
    baseUrl: cfg.baseUrl ?? process.env.OPENAI_BASE_URL,
  }
  const tools = opts.tools ?? defaultTools()
  return {
    cfg,
    provider: createProvider({ ...common, model: cfg.model }),
    compactProvider: createProvider({
      ...common,
      model: cfg.compactModel || defaultCompactModel(cfg.provider),
    }),
    registry: new Map(tools.map((t) => [t.name, t])),
    store: opts.store ?? new JSONLStore(),
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
  runtime?: Runtime
  model?: string
  maxSteps?: number
  compactThreshold?: number
}

/** Start a Turn via the launcher seam. */
export async function* runTurn(opts: TurnOpts): AsyncIterable<EngineEvent> {
  const rt = opts.runtime ?? launchRuntime({ model: opts.model })
  const sessionId = opts.sessionId ?? randomUUID()
  yield* run(opts.messages, {
    provider: rt.provider,
    registry: rt.registry,
    cwd: opts.cwd ?? process.cwd(),
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
    askPermission: opts.askPermission,
  })
}
