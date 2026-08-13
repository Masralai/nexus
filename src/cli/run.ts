import { randomUUID } from "node:crypto"
import { JSONLStore } from "../engine/state"
import type { Message, Tool } from "../engine/types"
import type { Provider } from "../providers/types"
import { runTUI } from "../tui"
import { launchRuntime, runTurn } from "./launch"

export function parseFlags(argv: string[]): { yes: boolean; model?: string; rest: string[] } {
  const yes = argv.includes("--yes")
  const i = argv.indexOf("--model")
  const model = i >= 0 ? argv[i + 1] : undefined
  const rest = argv.filter((a, idx) => a !== "--yes" && a !== "--model" && !(i >= 0 && idx === i + 1))
  return { yes, model, rest }
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
  },
): Promise<number> {
  const write = opts.write ?? ((s) => process.stdout.write(s))
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
  mode?: "plan" | "build"
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
