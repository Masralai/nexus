import { randomUUID } from "node:crypto"
import { run } from "../engine/loop"
import { JSONLStore } from "../engine/state"
import type { Message, Tool } from "../engine/types"
import { createProvider } from "../providers"
import type { Provider } from "../providers/types"
import { defaultTools } from "../tools"
import { runTUI } from "../tui"
import { defaultCompactModel, loadConfig, resolveApiKey } from "./config"

export function parseFlags(argv: string[]): { yes: boolean; model?: string; rest: string[] } {
  const yes = argv.includes("--yes")
  const i = argv.indexOf("--model")
  const model = i >= 0 ? argv[i + 1] : undefined
  const rest = argv.filter((a, idx) => a !== "--yes" && a !== "--model" && !(i >= 0 && idx === i + 1))
  return { yes, model, rest }
}

export function makeProvider(model?: string): { provider: Provider; cfg: ReturnType<typeof loadConfig>; compactProvider: Provider } {
  const cfg = loadConfig({ model })
  const apiKey = resolveApiKey(cfg)
  const common = {
    provider: cfg.provider,
    apiKey,
    baseUrl: cfg.baseUrl ?? process.env.OPENAI_BASE_URL,
  }
  return {
    cfg,
    provider: createProvider({ ...common, model: cfg.model }),
    compactProvider: createProvider({
      ...common,
      model: cfg.compactModel || defaultCompactModel(cfg.provider),
    }),
  }
}

export async function consumeHeadless(
  messages: Message[],
  opts: {
    provider: Provider
    registry: Map<string, Tool>
    cwd: string
    model: string
    maxSteps: number
    store: JSONLStore
    sessionId: string
    signal: AbortSignal
    autoApprove: boolean
    resume?: boolean
    compactProvider?: Provider
    compactThreshold?: number
    write?: (s: string) => void
  },
): Promise<number> {
  const write = opts.write ?? ((s) => process.stdout.write(s))
  let code = 0
  for await (const ev of run(messages, {
    provider: opts.provider,
    registry: opts.registry,
    cwd: opts.cwd,
    model: opts.model,
    maxSteps: opts.maxSteps,
    store: opts.store,
    sessionId: opts.sessionId,
    signal: opts.signal,
    autoApprove: opts.autoApprove,
    resume: opts.resume,
    compactProvider: opts.compactProvider,
    compactThreshold: opts.compactThreshold,
  })) {
    if (ev.type === "tokenDelta") write(ev.delta)
    else if (ev.type === "error") {
      write(`\nerror: ${ev.message}\n`)
      code = 1
    } else if (ev.type === "aborted") code = 2
  }
  if (code === 0) write("\n")
  return code
}

export async function selfTest(provider: Provider): Promise<number> {
  try {
    let ok = false
    for await (const ev of provider.stream([{ role: "user", content: "Reply with the single word: pong" }], [], {})) {
      if (ev.type === "token" || (ev.type === "done" && ev.content)) ok = true
    }
    return ok ? 0 : 1
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    return 1
  }
}

export interface SessionOpts {
  task?: string
  messages?: Message[]
  sessionId?: string
  resume?: boolean
  cwd?: string
  model?: string
  yes: boolean
  store?: JSONLStore
}

export async function runSession(opts: SessionOpts): Promise<number> {
  const { provider, cfg, compactProvider } = makeProvider(opts.model)
  const store = opts.store ?? new JSONLStore()
  const sessionId = opts.sessionId ?? randomUUID()
  const cwd = opts.cwd ?? process.cwd()
  const model = cfg.model || "(default)"
  const registry = new Map(defaultTools().map((t) => [t.name, t]))
  const messages = opts.messages ?? [{ role: "user" as const, content: opts.task ?? "" }]
  const ac = new AbortController()
  const onSig = () => ac.abort()
  process.once("SIGINT", onSig)

  console.error(`session: ${sessionId}`)

  const headless = opts.yes || !process.stdout.isTTY
  try {
    if (headless) {
      return await consumeHeadless(messages, {
        provider,
        registry,
        cwd,
        model,
        maxSteps: cfg.maxSteps,
        store,
        sessionId,
        signal: ac.signal,
        autoApprove: opts.yes,
        resume: opts.resume,
        compactProvider,
        compactThreshold: cfg.compactThreshold,
      })
    }
    return await new Promise<number>((resolve) => {
      runTUI({
        provider,
        registry,
        cwd,
        model,
        maxSteps: cfg.maxSteps,
        task: opts.task ?? messages.find((m) => m.role === "user")?.content ?? "",
        messages,
        store,
        sessionId,
        signal: ac.signal,
        abort: () => ac.abort(),
        autoApprove: opts.yes,
        resume: opts.resume,
        compactProvider,
        compactThreshold: cfg.compactThreshold,
        onDone: resolve,
      })
    })
  } finally {
    process.off("SIGINT", onSig)
  }
}
