import { Box, Text } from "ink"
import { useEffect, useState } from "react"
import type { EngineEvent } from "../engine/types"
import { Picker } from "./picker"
import { initialTUIState, reduceEvent, type PermissionRequest, type TUIState } from "./state"

export type TurnRunner = (
  emit: (ev: EngineEvent) => void,
  ask: (req: PermissionRequest) => Promise<boolean>,
) => Promise<void>

export interface LiveTurnViewProps {
  model: string
  /** Optional task headline (one-shot TUI). */
  task?: string
  run: TurnRunner
  onDone?: (code: number) => void
  onCtrlC?: () => void
  /** When true, render status footer (default true). */
  showStatus?: boolean
  /** External abort wiring — parent handles ctrl+c if provided via onCtrlC. */
  permissionTitle?: (req: PermissionRequest) => string
}

/**
 * Live turn view: reduce engine events + permission ask.
 * Shared by one-shot App and persistent Shell.
 */
export function LiveTurnView({
  model,
  task,
  run,
  onDone,
  showStatus = true,
  permissionTitle = (req) => `Allow ${req.name}? ${req.reason}`,
}: LiveTurnViewProps) {
  const [state, setState] = useState<TUIState>(() => initialTUIState(model))
  const [resolver, setResolver] = useState<((v: boolean) => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    const emit = (ev: EngineEvent): void => {
      if (!cancelled) setState((s) => reduceEvent(s, ev))
    }
    const ask = (req: PermissionRequest): Promise<boolean> =>
      new Promise((resolve) => {
        setState((s) => ({ ...s, permission: req }))
        setResolver(() => resolve)
      })
    void (async () => {
      await run(emit, ask)
    })().catch((e) => {
      if (!cancelled) setState((s) => ({ ...s, done: true, error: String(e) }))
    })
    return () => {
      cancelled = true
    }
  }, [run])

  useEffect(() => {
    if (state.done) onDone?.(state.aborted ? 2 : state.error ? 1 : 0)
  }, [state.done, state.aborted, state.error, onDone])

  const pct = state.status.limit ? `${(state.status.pct * 100).toFixed(0)}%` : "0%"

  return (
    <Box flexDirection="column">
      {task ? <Text bold>task: {task}</Text> : null}
      {state.lines.map((l, i) => (
        <Text key={i}>{l}</Text>
      ))}
      {state.assistantOutput ? <Text>{state.assistantOutput}</Text> : null}
      {state.permission && resolver ? (
        <Picker
          title={permissionTitle(state.permission)}
          items={[
            { id: "yes", label: "Approve" },
            { id: "no", label: "Deny" },
          ]}
          onSelect={(id) => {
            resolver(id === "yes")
            setResolver(null)
            setState((s) => ({ ...s, permission: null }))
          }}
          onCancel={() => {
            resolver(false)
            setResolver(null)
            setState((s) => ({ ...s, permission: null }))
          }}
        />
      ) : null}
      {showStatus ? (
        <Box marginTop={1}>
          <Text dimColor>
            ctx {state.status.used}/{state.status.limit} ({pct}) · steps {state.status.steps} · {model}
          </Text>
        </Box>
      ) : null}
      {state.error ? <Text color="red">error: {state.error}</Text> : null}
      {state.aborted ? <Text color="red">aborted</Text> : null}
    </Box>
  )
}
