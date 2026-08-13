import { useInput } from "ink"
import { LiveTurnView, type TurnRunner } from "./live-turn"
import type { PermissionRequest } from "./state"

export interface TUIOptions {
  model: string
  task: string
  run: TurnRunner
  onDone?: (code: number) => void
  onCtrlC?: () => void
}

export function App({ model, task, run, onDone, onCtrlC }: TUIOptions) {
  useInput((input, key) => {
    if (key.ctrl && input === "c") onCtrlC?.()
  })

  return <LiveTurnView model={model} task={task} run={run} onDone={onDone} />
}

export type { PermissionRequest, TurnRunner }
