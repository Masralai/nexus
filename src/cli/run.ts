import { randomUUID } from "node:crypto"
import type { SessionStore } from "../engine/store"
import type { EngineEvent, Message, Tool } from "../engine/types"
import type { Provider } from "../providers/types"
import { runTUI } from "../tui"
import { runAttached } from "./attach"
import { launchRuntime, runTurn } from "./launch"

export type OutputFormat = "text" | "ndjson"

export function parseFlags(argv: string[]): {
  yes: boolean
  auto: boolean
  mode?: "plan" | "build"
  model?: string
  format: OutputFormat
  attach: boolean
  rest: string[]
} {
  const yes = argv.includes("--yes") || argv.includes("--auto")
  const auto = argv.includes("--auto")
  const attach = argv.includes("--attach")
  const mode: "plan" | "build" | undefined = argv.includes("--plan") ? "plan" : argv.includes("--build") ? "build" : undefined
  const modelIdx = argv.indexOf("--model")
  const model = modelIdx >= 0 ? argv[modelIdx + 1] : undefined
  const formatIdx = argv.indexOf("--format")
  const formatRaw = formatIdx >= 0 ? argv[formatIdx + 1] : undefined
  const format: OutputFormat = formatRaw === "ndjson" || formatRaw === "json" ? "ndjson" : "text"
  const rest = argv.filter((a, idx) => {
    if (a === "--yes" || a === "--auto" || a === "--plan" || a === "--build" || a === "--attach") return false
    if (idx === modelIdx || (modelIdx >= 0 && idx === modelIdx + 1)) return false
    if (idx === formatIdx || (formatIdx >= 0 && idx === formatIdx + 1)) return false
    return true
  })
  return { yes, auto, attach, mode, model, format, rest }
}

/** @deprecated Prefer launchRuntime — kept for self-test and callers. */
export function makeProvider(model?: string): {
  provider: Provider
  cfg: ReturnType<typeof launchRuntime>["cfg"]
  compactProvider: Provider
} {
  const rt = launchRuntime({ model })
  return { provider: rt.provider, cfg: rt.cfg, compactProvider: rt.compactProvider }
}

export async function consumeHeadless(
  messages: Message[],
  opts: {
    runtime: ReturnType<typeof launchRuntime>
    cwd: string
    model: string
    maxSteps: number
    sessionId: string
    signal: AbortSignal
    autoApprove: boolean
    resume?: boolean
    mode?: "plan" | "build"
    write?: (s: string) => void
    format?: OutputFormat
  },
): Promise<number> {
  const write = opts.write ?? ((s) => process.stdout.write(s))
  const format = opts.format ?? "text"
  let code = 0
  for await (const ev of runTurn({
    messages,
    runtime: opts.runtime,
    cwd: opts.cwd,
    model: opts.model,
    maxSteps: opts.maxSteps,
    sessionId: opts.sessionId,
    signal: opts.signal,
    autoApprove: opts.autoApprove,
    resume: opts.resume,
    mode: opts.mode,
  })) {
    code = applyHeadlessEvent(ev, format, write, code)
  }
  if (code === 0 && format === "text") write("\n")
  return code
}

function applyHeadlessEvent(
  ev: EngineEvent,
  format: OutputFormat,
  write: (s: string) => void,
  code: number,
): number {
  if (format === "ndjson") {
    write(`${JSON.stringify(ev)}\n`)
    if (ev.type === "stepLimit") return 3
    if (ev.type === "error") return 1
    if (ev.type === "aborted") return 2
    return code
  }
  if (ev.type === "tokenDelta") write(ev.delta)
  else if (ev.type === "stepLimit") {
    write(`\nstep limit reached (${ev.steps} steps); session marked limit\n`)
    return 3
  } else if (ev.type === "error") {
    write(`\nerror: ${ev.message}\n`)
    return 1
  } else if (ev.type === "aborted") return 2
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
  store?: SessionStore
  mode?: "plan" | "build"
  format?: OutputFormat
  attach?: boolean
}

export async function runSession(opts: SessionOpts): Promise<number> {
  const runtime = launchRuntime({ model: opts.model, store: opts.store })
  const sessionId = opts.sessionId ?? randomUUID()
  const cwd = opts.cwd ?? process.cwd()
  const model = runtime.cfg.model || "(default)"
  const messages = opts.messages ?? [{ role: "user" as const, content: opts.task ?? "" }]
  const ac = new AbortController()
  const onSig = () => ac.abort()
  process.once("SIGINT", onSig)

  console.error(`session: ${sessionId}`)

  const headless = opts.yes || !process.stdout.isTTY
  try {
    if (opts.attach) {
      const task = opts.task ?? messages.find((m) => m.role === "user")?.content ?? ""
      return await runAttached({
        task,
        yes: opts.yes,
        model: opts.model,
        format: opts.format ?? "text",
        cwd,
        signal: ac.signal,
      })
    }
    if (headless) {
      return await consumeHeadless(messages, {
        runtime,
        cwd,
        model,
        maxSteps: runtime.cfg.maxSteps,
        sessionId,
        signal: ac.signal,
        autoApprove: opts.yes,
        resume: opts.resume,
        mode: opts.mode,
        format: opts.format,
      })
    }
    return await new Promise<number>((resolve) => {
      runTUI({
        runtime,
        cwd,
        model,
        maxSteps: runtime.cfg.maxSteps,
        task: opts.task ?? messages.find((m) => m.role === "user")?.content ?? "",
        messages,
        sessionId,
        signal: ac.signal,
        abort: () => ac.abort(),
        autoApprove: opts.yes,
        resume: opts.resume,
        mode: opts.mode,
        compactThreshold: runtime.cfg.compactThreshold,
        onDone: resolve,
      })
    })
  } finally {
    process.off("SIGINT", onSig)
  }
}

// re-export for tests that build registries
export type { Tool }
