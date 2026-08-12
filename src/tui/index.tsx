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
  store?: JSONLStore
}

export function runTUI(opts: TUIRunOptions): void {
  let instance: ReturnType<typeof render> | undefined
  instance = render(
    <App
      model={opts.model}
      task={opts.task}
      onDone={(code) => {
        instance?.unmount()
        process.exit(code)
      }}
      run={async (emit, ask) => {
        const messages: Message[] = [{ role: "user", content: opts.task }]
        for await (const ev of run(messages, {
          provider: opts.provider,
          registry: opts.registry,
          cwd: opts.cwd,
          model: opts.model,
          maxSteps: opts.maxSteps,
          store: opts.store,
          askPermission: ask,
        })) {
          emit(ev)
        }
      }}
    />,
  )
}