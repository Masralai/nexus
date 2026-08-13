import { useEffect, useRef, useState } from "react"
import { Box, Text, useApp, useInput } from "ink"
import { randomUUID } from "node:crypto"
import {
  applyPresetToConfig,
  hasResolvableKey,
  loadConfig,
  saveConfig,
} from "../cli/config"
import { setCredential } from "../cli/credentials"
import { launchRuntime, runTurn } from "../cli/launch"
import { JSONLStore } from "../engine/state"
import type { Message } from "../engine/types"
import type { AgentMode } from "../engine/mode"
import { PRESETS, getPreset, otherPreset } from "../providers/presets"
import { LineInput } from "./line-input"
import { Picker } from "./picker"
import { HELP, filterSlashCommands, parseSlash } from "./slash"
import { reduceEvent, initialTUIState, settleTurnView } from "./state"
import type { TUIState } from "./state"
import { formatTranscript } from "./transcript"

type Overlay =
  | null
  | { kind: "picker"; title: string; items: { id: string; label: string }[]; then: (id: string) => void }
  | { kind: "line"; label: string; mask?: boolean; then: (v: string) => void }
  | { kind: "permission"; title: string; resolve: (ok: boolean) => void }

export function Shell() {
  const { exit } = useApp()
  const store = useRef(new JSONLStore()).current
  const [sessionId, setSessionId] = useState(String(randomUUID()))
  const [messages, setMessages] = useState<Message[]>([])
  const [created, setCreated] = useState(false)
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<TUIState>(() => initialTUIState(loadConfig().model || "?"))
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [log, setLog] = useState<string[]>([])
  const [slashIdx, setSlashIdx] = useState(0)
  const [mode, setMode] = useState<AgentMode>("build")
  const acRef = useRef<AbortController | null>(null)

  const pushLog = (line: string) => setLog((l) => [...l, line])

  const needKey = !hasResolvableKey()
  const slashMatches = filterSlashCommands(input)
  const slashOpen = !overlay && !busy && input.startsWith("/")

  useEffect(() => {
    if (needKey) startKeyFlow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startKeyFlow() {
    setOverlay({
      kind: "picker",
      title: "Select provider (/key)",
      items: [...PRESETS.map((p) => ({ id: p.id, label: p.label })), { id: "__other__", label: "Other (custom base URL)" }],
      then: (id) => {
        if (id === "__other__") {
          setOverlay({
            kind: "line",
            label: "preset id: ",
            then: (customId) => {
              setOverlay({
                kind: "line",
                label: "base URL: ",
                then: (baseUrl) => {
                  setOverlay({
                    kind: "line",
                    label: "API key: ",
                    mask: true,
                    then: (apiKey) => {
                      const preset = otherPreset(customId.trim() || "custom", baseUrl.trim())
                      setCredential(preset.id, { apiKey, baseUrl: preset.baseUrl })
                      applyPresetToConfig(preset)
                      setOverlay(null)
                      pushLog(`connected: ${preset.id}`)
                      setView((s) => ({ ...s, status: { ...s.status, model: loadConfig().model || "?" } }))
                    },
                  })
                },
              })
            },
          })
          return
        }
        const preset = getPreset(id)!
        setOverlay({
          kind: "line",
          label: `API key (${preset.label}): `,
          mask: true,
          then: (apiKey) => {
            const key = apiKey || (preset.id === "ollama" ? "ollama" : apiKey)
            if (!key) {
              pushLog("key required")
              setOverlay(null)
              return
            }
            setCredential(preset.id, { apiKey: key, baseUrl: preset.baseUrl })
            applyPresetToConfig(preset)
            setOverlay(null)
            pushLog(`connected: ${preset.label}`)
            setView((s) => ({ ...s, status: { ...s.status, model: loadConfig().model || preset.suggestedModels[0] || "?" } }))
          },
        })
      },
    })
  }

  function startModelFlow() {
    const c = loadConfig()
    const preset = getPreset(c.preset)
    const suggested = preset?.suggestedModels ?? []
    setOverlay({
      kind: "picker",
      title: "Select model (/model)",
      items: [...suggested.map((m) => ({ id: m, label: m })), { id: "__custom__", label: "Custom…" }],
      then: (id) => {
        if (id === "__custom__") {
          setOverlay({
            kind: "line",
            label: "model id: ",
            then: (m) => {
              saveConfig({ model: m.trim() })
              setOverlay(null)
              pushLog(`model: ${m.trim()}`)
              setView((s) => ({ ...s, status: { ...s.status, model: m.trim() } }))
            },
          })
          return
        }
        saveConfig({ model: id })
        setOverlay(null)
        pushLog(`model: ${id}`)
        setView((s) => ({ ...s, status: { ...s.status, model: id } }))
      },
    })
  }

  function startResumeFlow() {
    const sessions = store.list()
    if (sessions.length === 0) {
      pushLog("no sessions to resume")
      return
    }
    setOverlay({
      kind: "picker",
      title: "Resume session",
      items: sessions.map((s) => ({
        id: s.id,
        label: `${s.id.slice(0, 8)}… ${s.model} ${s.createdAt}`,
      })),
      then: (id) => {
        const loaded = store.load(id)
        setSessionId(String(loaded.meta.id))
        setMessages(loaded.messages)
        setCreated(true)
        setOverlay(null)
        setLog([])
        setView(initialTUIState(loaded.meta.model))
      },
    })
  }

  async function runTurnUi(userText: string) {
    if (!hasResolvableKey()) {
      pushLog("not connected — run /key")
      startKeyFlow()
      return
    }
    const nextMsgs = [...messages, { role: "user" as const, content: userText }]
    setMessages(nextMsgs)
    setBusy(true)
    setView(initialTUIState(loadConfig().model || "?"))
    const ac = new AbortController()
    acRef.current = ac
    const runtime = launchRuntime({ store })
    const resume = created
    if (!created) setCreated(true)

    try {
      for await (const ev of runTurn({
        messages: nextMsgs,
        runtime,
        cwd: process.cwd(),
        sessionId,
        signal: ac.signal,
        resume,
        mode,
        askPermission: (req) =>
          new Promise<boolean>((resolve) => {
            setOverlay({
              kind: "permission",
              title: `Allow ${req.name}? ${req.reason}`,
              resolve: (ok) => {
                setOverlay(null)
                resolve(ok)
              },
            })
          }),
      })) {
        setView((s) => reduceEvent(s, ev))
        if (ev.type === "runComplete" || ev.type === "aborted" || ev.type === "error") {
          try {
            setMessages(store.load(sessionId).messages)
          } catch {
            /* first create race */
          }
          setView((s) => settleTurnView(s, ev))
        }
      }
    } finally {
      setBusy(false)
      acRef.current = null
      try {
        setMessages(store.load(sessionId).messages)
      } catch {
        /* ignore */
      }
    }
  }

  function handleSlash(raw: string) {
    const cmd = parseSlash(raw)
    if (cmd === "help") pushLog(HELP)
    else if (cmd === "quit" || cmd === "exit") exit()
    else if (cmd === "key") startKeyFlow()
    else if (cmd === "model") startModelFlow()
    else if (cmd === "resume") startResumeFlow()
    else if (cmd === "plan") {
      setMode("plan")
      pushLog("mode: plan (read-only)")
    } else if (cmd === "build") {
      setMode("build")
      pushLog("mode: build")
    } else if (cmd === "new") {
      setSessionId(String(randomUUID()))
      setMessages([])
      setCreated(false)
      setLog([])
      setView(initialTUIState(loadConfig().model || "?"))
    } else pushLog(`unknown command: /${cmd} — type / for options`)
  }

  useInput((ch, key) => {
    if (overlay) return
    if (key.ctrl && ch === "c") {
      if (busy && acRef.current) {
        acRef.current.abort()
        pushLog("aborted turn")
      } else exit()
      return
    }
    if (busy) return

    if (slashOpen && slashMatches.length > 0) {
      if (key.upArrow) {
        setSlashIdx((i) => (i - 1 + slashMatches.length) % slashMatches.length)
        return
      }
      if (key.downArrow) {
        setSlashIdx((i) => (i + 1) % slashMatches.length)
        return
      }
      if (key.escape) {
        setInput("")
        setSlashIdx(0)
        return
      }
      if (key.return) {
        const pick = slashMatches[slashIdx] ?? slashMatches[0]
        setInput("")
        setSlashIdx(0)
        if (pick) handleSlash(`/${pick.id}`)
        return
      }
    }

    if (key.return) {
      const line = input.trim()
      setInput("")
      setSlashIdx(0)
      if (!line) return
      if (line.startsWith("/")) handleSlash(line)
      else void runTurnUi(line)
      return
    }
    if (key.backspace || key.delete) {
      setInput((v) => v.slice(0, -1))
      setSlashIdx(0)
      return
    }
    if (key.ctrl || key.meta || key.upArrow || key.downArrow) return
    if (ch) {
      setInput((v) => v + ch)
      setSlashIdx(0)
    }
  })

  const model = loadConfig().model || "?"
  const pct = view.status.limit ? `${(view.status.pct * 100).toFixed(0)}%` : "0%"
  const transcript = formatTranscript(messages)

  return (
    <Box flexDirection="column">
      {transcript.slice(-80).map((l, i) => (
        <Text key={`t${i}`}>{l}</Text>
      ))}
      {busy ? (
        <>
          {view.lines.map((l, i) => (
            <Text key={`v${i}`}>{l}</Text>
          ))}
          {view.assistantOutput ? <Text>{view.assistantOutput}</Text> : null}
        </>
      ) : null}
      {log.slice(-20).map((l, i) => (
        <Text key={`l${i}`} dimColor>
          {l}
        </Text>
      ))}
      {view.error ? <Text color="red">error: {view.error}</Text> : null}
      {view.aborted ? <Text color="yellow">aborted</Text> : null}

      <Box marginTop={1}>
        {overlay?.kind === "picker" ? (
          <Picker
            title={overlay.title}
            items={overlay.items}
            onSelect={(id) => overlay.then(id)}
            onCancel={() => setOverlay(null)}
          />
        ) : overlay?.kind === "line" ? (
          <LineInput
            label={overlay.label}
            mask={overlay.mask}
            onSubmit={(v) => overlay.then(v)}
            onCancel={() => setOverlay(null)}
          />
        ) : overlay?.kind === "permission" ? (
          <Picker
            title={overlay.title}
            items={[
              { id: "yes", label: "Approve" },
              { id: "no", label: "Deny" },
            ]}
            onSelect={(id) => overlay.resolve(id === "yes")}
            onCancel={() => overlay.resolve(false)}
          />
        ) : (
          <Box flexDirection="column">
            <Text>
              {busy ? (
                <Text dimColor>… running (Ctrl+C abort)</Text>
              ) : (
                <Text>
                  {"> "}
                  {input}
                  <Text dimColor>█</Text>
                </Text>
              )}
            </Text>
            {slashOpen ? (
              <Box flexDirection="column" marginTop={1}>
                {slashMatches.length === 0 ? (
                  <Text dimColor>no matching commands</Text>
                ) : (
                  slashMatches.map((c, i) => (
                    <Text key={c.id} color={i === slashIdx ? "cyan" : undefined}>
                      {i === slashIdx ? "❯ " : "  "}/{c.id}
                      <Text dimColor>  {c.hint}</Text>
                    </Text>
                  ))
                )}
                <Text dimColor>↑↓ select · Enter run · Esc clear</Text>
              </Box>
            ) : null}
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          session {sessionId.slice(0, 8)} · {mode} · {model} · ctx {view.status.used}/{view.status.limit} ({pct}) · steps{" "}
          {view.status.steps}
          {!hasResolvableKey() ? " · not connected" : ""}
        </Text>
      </Box>
    </Box>
  )
}
