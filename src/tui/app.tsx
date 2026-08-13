import { Box, Text, useInput } from "ink"
import { useEffect, useState } from "react"
import type { EngineEvent } from "../engine/types"
import { initialTUIState, reduceEvent } from "./state"
import type { PermissionRequest, TUIState } from "./state"
import { Picker } from "./picker"

export interface TUIOptions {
  model: string
  task: string
  run: (emit: (ev: EngineEvent) => void, ask: (req: PermissionRequest) => Promise<boolean>) => Promise<void>
  onDone?: (code: number) => void
  onCtrlC?: () => void
}

export function App({ model, task, run, onDone, onCtrlC }: TUIOptions) {
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

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      resolver?.(false)
      setResolver(null)
      setState((s) => ({ ...s, permission: null }))
      onCtrlC?.()
      return
    }
    // permission handled by Picker when visible
    if (state.permission) return
  })

  useEffect(() => {
    if (state.done) onDone?.(state.aborted ? 2 : state.error ? 1 : 0)
  }, [state.done, state.aborted, state.error, onDone])

  const pct = state.status.limit ? `${(state.status.pct * 100).toFixed(0)}%` : "0%"

  return (
    <Box flexDirection="column">
      <Text bold>task: {task}</Text>
      {state.lines.map((l, i) => (
        <Text key={i}>{l}</Text>
      ))}
      {state.assistantOutput ? <Text>{state.assistantOutput}</Text> : null}
      {state.permission && resolver ? (
        <Picker
          title={`Allow ${state.permission.name}? ${state.permission.reason}`}
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
      <Box marginTop={1}>
        <Text dimColor>
          ctx {state.status.used}/{state.status.limit} ({pct}) · steps {state.status.steps} · {model}
        </Text>
      </Box>
      {state.error ? <Text color="red">error: {state.error}</Text> : null}
      {state.aborted ? <Text color="red">aborted</Text> : null}
    </Box>
  )
}
