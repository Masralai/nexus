import { useEffect, useRef, useState } from "react"
import { Box, useApp, useInput, useStdout } from "ink"
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
import { discoverSkills, findSkill, type Skill } from "../skills"
import { copyToClipboard } from "./clipboard"
import { Composer } from "./composer"
import { Header } from "./header"
import { LineInput } from "./line-input"
import { disableMouse, enableMouse, parseMouseEvent } from "./mouse"
import { PermissionGate } from "./permission-gate"
import { Picker } from "./picker"
import { extractSelection, initialChrome, present, reduceChrome, screenRows, streamRows, windowStream } from "./present"
import type { SelectionAnchor } from "./present"
import { HELP, filterSlashCommands, parseSlash, parseSlashArgs } from "./slash"
import { Stream } from "./stream"
import { reduceEvent, initialTUIState, settleTurnView } from "./state"
import type { TUIState } from "./state"
import { theme } from "./theme"

type Overlay =
  | null
  | {
      kind: "picker"
      title: string
      items: { id: string; label: string; searchText?: string }[]
      searchable?: boolean
      then: (id: string) => void
    }
  | { kind: "line"; label: string; mask?: boolean; then: (v: string) => void }
  | { kind: "permission"; name: string; reason: string; input: unknown; resolve: (ok: boolean) => void }

export function Shell() {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const store = useRef(new JSONLStore()).current
  const [sessionId, setSessionId] = useState(String(randomUUID()))
  const [messages, setMessages] = useState<Message[]>([])
  const [created, setCreated] = useState(false)
  const [chrome, setChrome] = useState(initialChrome)
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState<TUIState>(() => initialTUIState(loadConfig().model || "?"))
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [log, setLog] = useState<string[]>([])
  const [mode, setMode] = useState<AgentMode>("build")
  const [activeSkills, setActiveSkills] = useState<Skill[]>([])
  const acRef = useRef<AbortController | null>(null)
  const [selAnchor, setSelAnchor] = useState<SelectionAnchor | undefined>()
  const [selActive, setSelActive] = useState<SelectionAnchor | undefined>()
  const selDragging = useRef(false)

  const pushLog = (line: string) => setLog((l) => [...l, line])

  const needKey = !hasResolvableKey()
  const slashMatches = filterSlashCommands(chrome.input)
  const slashOpen = !overlay && !busy && chrome.input.startsWith("/")
  const cols = stdout?.columns ?? 80
  const rows = stdout?.rows ?? 24
  const HEADER_ROWS = 3
  const COMPOSER_ROWS = 3
  const streamH = Math.max(4, rows - HEADER_ROWS - COMPOSER_ROWS)
  const t = theme()

  const shown = present({
    messages,
    live,
    sessionId,
    mode,
    skillNames: activeSkills.map((s) => s.name),
    connected: hasResolvableKey(),
    busy,
    overlay: overlay?.kind ?? null,
    chrome,
    log,
  })

  useEffect(() => {
    if (needKey) startKeyFlow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!stdout) return
    enableMouse(stdout)
    return () => disableMouse(stdout)
  }, [stdout])

  function pageScroll(dir: "up" | "down") {
    const page = Math.max(1, Math.floor(streamH / 2))
    const contentLength = streamRows(shown.stream, cols)
    setChrome((c) =>
      reduceChrome(c, {
        type: dir === "up" ? "pageUp" : "pageDown",
        page,
        contentLength,
        viewHeight: streamH,
      }),
    )
  }

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
                      setLive((s) => ({ ...s, status: { ...s.status, model: loadConfig().model || "?" } }))
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
            setLive((s) => ({
              ...s,
              status: { ...s.status, model: loadConfig().model || preset.suggestedModels[0] || "?" },
            }))
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
              setLive((s) => ({ ...s, status: { ...s.status, model: m.trim() } }))
            },
          })
          return
        }
        saveConfig({ model: id })
        setOverlay(null)
        pushLog(`model: ${id}`)
        setLive((s) => ({ ...s, status: { ...s.status, model: id } }))
      },
    })
  }

  function activateSkill(skill: Skill) {
    setActiveSkills((prev) => {
      if (prev.some((s) => s.id === skill.id)) return prev
      return [...prev, skill]
    })
    pushLog(`skill on: ${skill.name}`)
  }

  function startSkillFlow() {
    const catalog = discoverSkills()
    if (catalog.length === 0) {
      pushLog("no skills found (~/.agents/skills, ~/.claude/skills, ~/.cursor/skills-cursor, .agents/skills)")
      return
    }
    const activeIds = new Set(activeSkills.map((s) => s.id))
    setOverlay({
      kind: "picker",
      title: `Activate skill (${activeIds.size} active)`,
      searchable: true,
      items: [
        ...catalog.map((s) => ({
          id: s.id,
          label: activeIds.has(s.id)
            ? `${s.name} ✓${s.description ? ` — ${s.description.slice(0, 50)}` : ""}`
            : s.description
              ? `${s.name} — ${s.description.slice(0, 60)}`
              : s.name,
          searchText: `${s.id} ${s.name} ${s.description} ${s.path}`,
        })),
        ...(activeSkills.length ? [{ id: "__clear__", label: "Clear active skills" }] : []),
      ],
      then: (id) => {
        setOverlay(null)
        if (id === "__clear__") {
          setActiveSkills([])
          pushLog("skills cleared")
          return
        }
        const skill = catalog.find((s) => s.id === id)
        if (skill) activateSkill(skill)
      },
    })
  }

  function handleSkillCommand(args: string) {
    if (!args || args === "list") {
      startSkillFlow()
      return
    }
    if (args === "clear" || args === "off") {
      setActiveSkills([])
      pushLog("skills cleared")
      return
    }
    const catalog = discoverSkills()
    const skill = findSkill(catalog, args)
    if (!skill) {
      pushLog(`unknown skill: ${args} — try /skill`)
      return
    }
    activateSkill(skill)
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
        setChrome(initialChrome())
        setLive(initialTUIState(loaded.meta.model))
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
    setLive(initialTUIState(loadConfig().model || "?"))
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
        skills: activeSkills,
        askPermission: (req) =>
          new Promise<boolean>((resolve) => {
            setOverlay({
              kind: "permission",
              name: req.name,
              reason: req.reason,
              input: req.input,
              resolve: (ok) => {
                setOverlay(null)
                resolve(ok)
              },
            })
          }),
      })) {
        setLive((s) => reduceEvent(s, ev))
        if (ev.type === "runComplete" || ev.type === "aborted" || ev.type === "error") {
          try {
            setMessages(store.load(sessionId).messages)
          } catch {
            /* first create race */
          }
          setLive((s) => settleTurnView(s, ev))
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
    else if (cmd === "skill" || cmd === "skills") handleSkillCommand(parseSlashArgs(raw))
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
      setActiveSkills([])
      setLog([])
      setChrome(initialChrome())
      setLive(initialTUIState(loadConfig().model || "?"))
    } else {
      const skill = findSkill(discoverSkills(), cmd)
      if (skill) activateSkill(skill)
      else pushLog(`unknown command: /${cmd} — type / for options`)
    }
  }

  useInput((ch, key) => {
    const mouse = parseMouseEvent(ch)

    // Wheel scroll
    if (mouse?.type === "wheel") {
      if (mouse.button === 4) pageScroll("up")
      else pageScroll("down")
      return
    }

    // Mouse press (left button)
    if (mouse?.type === "press" && mouse.button === 0) {
      const contentLength = streamRows(shown.stream, cols)
      const maxRow = Math.max(0, contentLength - 1)
      const row = Math.max(0, Math.min(maxRow, mouse.row))
      const col = Math.max(0, mouse.col)
      selDragging.current = true
      setSelAnchor({ row, col })
      setSelActive({ row, col })
      return
    }

    // Mouse drag (left button held)
    if (mouse?.type === "drag" && mouse.button === 0 && selDragging.current) {
      const contentLength = streamRows(shown.stream, cols)
      const maxRow = Math.max(0, contentLength - 1)
      const row = Math.max(0, Math.min(maxRow, mouse.row))
      const col = Math.max(0, mouse.col)
      setSelActive({ row, col })
      return
    }

    // Mouse release (left button)
    if (mouse?.type === "release" && mouse.button === 0 && selDragging.current) {
      selDragging.current = false
      const contentLength = streamRows(shown.stream, cols)
      const maxRow = Math.max(0, contentLength - 1)
      const row = Math.max(0, Math.min(maxRow, mouse.row))
      const col = Math.max(0, mouse.col)
      const finalActive = { row, col }
      setSelActive(finalActive)

      // Copy selection if there is one
      setSelAnchor((anchor) => {
        if (anchor && stdout) {
          const rows = screenRows(windowed, cols)
          const text = extractSelection(rows, anchor, finalActive, cols)
          if (text.length > 0) {
            copyToClipboard(text, stdout)
          }
        }
        return anchor
      })
      return
    }

    // Any other mouse event - clear selection and ignore
    if (mouse) return

    // Clear selection on keyboard input (except during scroll/copy)
    if (selAnchor) {
      setSelAnchor(undefined)
      setSelActive(undefined)
    }

    if (overlay) return
    if (key.ctrl && ch === "c") {
      if (busy && acRef.current) {
        acRef.current.abort()
        pushLog("aborted turn")
      } else exit()
      return
    }

    if (key.pageUp || (key.ctrl && (ch === "u" || ch === "\x15"))) {
      pageScroll("up")
      return
    }
    if (key.pageDown || (key.ctrl && (ch === "d" || ch === "\x04"))) {
      pageScroll("down")
      return
    }

    // Shift+Tab: toggle plan/build mode (works even with text in input)
    if (key.tab && key.shift && !busy && !overlay) {
      setMode((m) => (m === "plan" ? "build" : "plan"))
      return
    }

    if (busy) return

    if (slashOpen && slashMatches.length > 0) {
      if (key.upArrow) {
        setChrome((c) => reduceChrome(c, { type: "slashPrev", count: slashMatches.length }))
        return
      }
      if (key.downArrow) {
        setChrome((c) => reduceChrome(c, { type: "slashNext", count: slashMatches.length }))
        return
      }
      if (key.escape) {
        setChrome((c) => reduceChrome(c, { type: "clear" }))
        return
      }
      if (key.return) {
        const pick = slashMatches[chrome.slashIdx] ?? slashMatches[0]
        setChrome((c) => reduceChrome(c, { type: "clear" }))
        if (pick) handleSlash(`/${pick.id}`)
        return
      }
    }

    if (key.return) {
      const line = chrome.input.trim()
      if (line.startsWith("/")) {
        setChrome((c) => reduceChrome(c, { type: "clear" }))
        if (line) handleSlash(line)
        return
      }
      setChrome((c) => reduceChrome(c, { type: "commitUser" }))
      if (line) void runTurnUi(line)
      return
    }
    if (key.escape) {
      setChrome((c) => reduceChrome(c, { type: "clear" }))
      return
    }
    if (key.leftArrow) {
      setChrome((c) => reduceChrome(c, { type: "left" }))
      return
    }
    if (key.rightArrow) {
      setChrome((c) => reduceChrome(c, { type: "right" }))
      return
    }
    if (key.upArrow) {
      setChrome((c) => reduceChrome(c, { type: "historyPrev" }))
      return
    }
    if (key.downArrow) {
      setChrome((c) => reduceChrome(c, { type: "historyNext" }))
      return
    }
    if (key.backspace) {
      setChrome((c) => reduceChrome(c, { type: "backspace" }))
      return
    }
    if (key.delete) {
      setChrome((c) => reduceChrome(c, { type: "delete" }))
      return
    }
    if (key.ctrl || key.meta) return
    if (ch.startsWith("\x1b") || ch.startsWith("[<")) return
    if (ch) setChrome((c) => reduceChrome(c, { type: "insert", ch }))
  })

  const contentLength = streamRows(shown.stream, cols)
  const scrollable = contentLength > streamH
  const windowed = windowStream(shown.stream, {
    cols,
    height: streamH,
    offset: shown.viewportOffset,
    followTail: shown.followTail,
  })

  return (
    <Box flexDirection="column" width={cols}>
      <Header header={shown.header} cols={cols} t={t} />
      <Stream blocks={windowed} height={streamH} busy={busy} t={t} cols={cols} anchor={selAnchor} active={selActive} />
      <Box marginTop={1}>
        {overlay?.kind === "picker" ? (
          <Picker
            title={overlay.title}
            items={overlay.items}
            searchable={overlay.searchable}
            selectedColor={t.gold}
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
          <PermissionGate
            name={overlay.name}
            reason={overlay.reason}
            input={overlay.input}
            onResolve={overlay.resolve}
          />
        ) : (
          <Composer
            mode={shown.composer.mode}
            value={shown.composer.value}
            cursor={shown.composer.cursor}
            busy={shown.composer.busy}
            slashIdx={shown.composer.slashIdx}
            scrollable={scrollable}
            t={t}
          />
        )}
      </Box>
    </Box>
  )
}
