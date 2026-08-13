import { render } from "ink"
import type { Provider } from "../providers/types"
import type { JSONLStore } from "../engine/state"
import { run } from "../engine/loop"
import type { Message, Tool } from "../engine/types"
import { App } from "./app"

export interface TUIRunOptions {
  provider: Provider
  registry: Map<string, Tool>
  cwd: string
  model: string
  maxSteps: number
  task: string
  messages?: Message[]
  store?: JSONLStore
  sessionId?: string
  signal?: AbortSignal
  abort?: () => void
  autoApprove?: boolean
  resume?: boolean
  onDone?: (code: number) => void
}

export function runTUI(opts: TUIRunOptions): void {
  let instance: ReturnType<typeof render> | undefined
  // ponytail: ink default exitOnCtrlC bypasses AbortController; we abort then exit via onDone
  instance = render(
    <App
      model={opts.model}
      task={opts.task}
      onCtrlC={() => opts.abort?.()}
      onDone={(code) => {
        instance?.unmount()
        opts.onDone?.(code)
      }}
      run={async (emit, ask) => {
        const messages = opts.messages ?? [{ role: "user", content: opts.task }]
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
          askPermission: ask,
        })) {
          emit(ev)
        }
      }}
    />,
    { exitOnCtrlC: false },
  )
}
