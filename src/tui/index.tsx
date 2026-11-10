import { render } from "ink"
import type { Runtime } from "../cli/launch"
import { runTurn } from "../cli/launch"
import type { AgentMode } from "../engine/mode"
import type { Message } from "../engine/types"
import type { Skill } from "../skills"
import { NexusClient } from "../sdk/client"
import { startServer } from "../server/server"
import { discoverService } from "../server/state"
import { App } from "./app"
import { Shell } from "./shell"

export interface TUIRunOptions {
  runtime: Runtime
  cwd: string
  model: string
  maxSteps: number
  task: string
  messages?: Message[]
  sessionId?: string
  signal?: AbortSignal
  abort?: () => void
  autoApprove?: boolean
  resume?: boolean
  mode?: AgentMode
  skills?: Skill[]
  compactThreshold?: number
  onDone?: (code: number) => void
}

export function runTUI(opts: TUIRunOptions): void {
  let instance: ReturnType<typeof render> | undefined
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
          skills: opts.skills,
          compactThreshold: opts.compactThreshold,
          askPermission: ask,
        })) {
          emit(ev)
        }
      }}
    />,
    { exitOnCtrlC: false },
  )
}

export async function runShell(): Promise<void> {
  const existing = discoverService()
  const embedded = existing ? undefined : await startServer({ port: 0 })
  const client = new NexusClient({
    url: existing?.url ?? embedded!.url,
    token: existing?.password ?? embedded!.token,
  })
  const instance = render(<Shell client={client} />, { exitOnCtrlC: false })
  await instance.waitUntilExit()
  await embedded?.stop()
}
