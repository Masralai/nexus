import { useEffect, useRef, useState } from "react"
import { Box, Text, useApp, useInput } from "ink"
import { randomUUID } from "node:crypto"
import {
  applyPresetToConfig,
  defaultCompactModel,
  hasResolvableKey,
  loadConfig,
  resolveApiKey,
  saveConfig,
} from "../cli/config"
import { setCredential } from "../cli/credentials"
import { run } from "../engine/loop"
import { JSONLStore } from "../engine/state"
import type { Message } from "../engine/types"
import { createProvider } from "../providers"
import { PRESETS, getPreset, otherPreset } from "../providers/presets"
import { defaultTools } from "../tools"
import { LineInput } from "./line-input"
import { Picker } from "./picker"
import { reduceEvent, initialTUIState } from "./state"
import type { TUIState } from "./state"

type Overlay =
  | null
  | { kind: "picker"; title: string; items: { id: string; label: string }[]; then: (id: string) => void }
  | { kind: "line"; label: string; mask?: boolean; then: (v: string) => void }
  | { kind: "permission"; title: string; resolve: (ok: boolean) => void }

const HELP = `/key     connect provider + API key
/model   set model
/resume  continue a past session
/new     start a fresh session
/help    this list
/quit    exit`

function buildProviders(model?: string) {
  const cfg = loadConfig({ model })
  const apiKey = resolveApiKey(cfg)
  const common = { provider: cfg.provider, apiKey, baseUrl: cfg.baseUrl }
  return {
    cfg,
    provider: createProvider({ ...common, model: cfg.model }),
    compactProvider: createProvider({
      ...common,
      model: cfg.compactModel || defaultCompactModel(cfg.provider),
    }),
  }
}

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
  const [log, setLog] = useState<string[]>(["nexus shell — type a message or /help"])
  const acRef = useRef<AbortController | null>(null)

  const pushLog = (line: string) => setLog((l) => [...l, line])

  const needKey = !hasResolvableKey()

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
            // ollama often needs any non-empty key
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
        pushLog(`resumed ${id}`)
        setView(initialTUIState(loaded.meta.model))
      },
    })
  }

  async function runTurn(userText: string) {
    if (!hasResolvableKey()) {
      pushLog("not connected — run /key")
      startKeyFlow()
      return
    }
    const nextMsgs = [...messages, { role: "user" as const, content: userText }]
    setMessages(nextMsgs)
    pushLog(`you: ${userText}`)
    setBusy(true)
    setView(initialTUIState(loadConfig().model || "?"))
    const ac = new AbortController()
    acRef.current = ac
    const { provider, cfg, compactProvider } = buildProviders()
    const registry = new Map(defaultTools().map((t) => [t.name, t]))
    const resume = created
    if (!created) setCreated(true)

    try {
      for await (const ev of run(nextMsgs, {
        provider,
        registry,
        cwd: process.cwd(),
        model: cfg.model || "(default)",
        maxSteps: cfg.maxSteps,
        store,
        sessionId,
        signal: ac.signal,
        resume,
        compactProvider,
        compactThreshold: cfg.compactThreshold,
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
          // keep messages array in sync from store
          try {
            setMessages(store.load(sessionId).messages)
          } catch {
            /* first create race */
          }
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
    const cmd = raw.slice(1).trim().split(/\s+/)[0]?.toLowerCase() ?? ""
    if (cmd === "help") pushLog(HELP)
    else if (cmd === "quit" || cmd === "exit") exit()
    else if (cmd === "key") startKeyFlow()
    else if (cmd === "model") startModelFlow()
    else if (cmd === "resume") startResumeFlow()
    else if (cmd === "new") {
      setSessionId(String(randomUUID()))
      setMessages([])
      setCreated(false)
      setView(initialTUIState(loadConfig().model || "?"))
      pushLog("new session")
    } else pushLog(`unknown command: /${cmd} — try /help`)
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
    if (key.return) {
      const line = input.trim()
      setInput("")
      if (!line) return
      if (line.startsWith("/")) handleSlash(line)
      else void runTurn(line)
      return
    }
    if (key.backspace || key.delete) {
      setInput((v) => v.slice(0, -1))
      return
    }
    if (key.ctrl || key.meta || key.upArrow || key.downArrow) return
    if (ch) setInput((v) => v + ch)
  })

  const model = loadConfig().model || "?"
  const pct = view.status.limit ? `${(view.status.pct * 100).toFixed(0)}%` : "0%"

  return (
    <Box flexDirection="column">
      {log.slice(-30).map((l, i) => (
        <Text key={`l${i}`}>{l}</Text>
      ))}
      {view.lines.map((l, i) => (
        <Text key={`v${i}`}>{l}</Text>
      ))}
      {view.assistantOutput ? <Text>{view.assistantOutput}</Text> : null}
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
          <Text>
            {busy ? <Text dimColor>… running (Ctrl+C abort)</Text> : <Text>{"> "}{input}<Text dimColor>█</Text></Text>}
          </Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          session {sessionId.slice(0, 8)} · {model} · ctx {view.status.used}/{view.status.limit} ({pct}) · steps{" "}
          {view.status.steps}
          {!hasResolvableKey() ? " · not connected" : ""}
        </Text>
      </Box>
    </Box>
  )
}
