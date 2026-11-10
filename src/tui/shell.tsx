import { useEffect, useRef, useState } from "react"
import { Box, Text, useApp, useInput, useStdout } from "ink"
import { hasResolvableKey, loadConfig } from "../cli/config"
import { expandCommand, findAgent, findCommand, configuredCommands, type ResolvedAgent } from "../cli/commands"
import type { Message } from "../engine/types"
import type { AgentMode } from "../engine/mode"
import { NexusClient } from "../sdk/client"
import { PRESETS, getPreset, otherPreset } from "../providers/presets"
import { findSkill, type Skill } from "../skills"
import { copyToClipboard } from "./clipboard"
import { Composer } from "./composer"
import { Footer } from "./footer"
import { LineInput } from "./line-input"
import { disableMouse, enableMouse, parseMouseEvent } from "./mouse"
import { PermissionGate } from "./permission-gate"
import { Picker } from "./picker"
import { appendHistory, loadHistory } from "./history"
import {
  clampOffset,
  extractSelection,
  initialChrome,
  interpolatedOffset,
  maxStart,
  present,
  reduceChrome,
  screenRows,
  scrollStep,
  streamRows,
  windowStream,
} from "./present"
import type { SelectionAnchor } from "./present"
import { HELP, filterSlashCommands, parseSlash, parseSlashArgs } from "./slash"
import { Stream } from "./stream"
import { runServerTurn } from "./server-turn"
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

export function Shell({ client }: { client: NexusClient }) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [sessionId, setSessionId] = useState("")
  const sessionRef = useRef("")
  const [messages, setMessages] = useState<Message[]>([])
  const [chrome, setChrome] = useState(() => ({ ...initialChrome(), history: loadHistory() }))
  const [busy, setBusy] = useState(false)
  const [busySince, setBusySince] = useState<number | undefined>(undefined)
  const [tick, setTick] = useState(0)
  const [live, setLive] = useState<TUIState>(() => initialTUIState(loadConfig().model || "?"))
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [log, setLog] = useState<string[]>([])
  const [mode, setMode] = useState<AgentMode>("build")
  const [activeSkills, setActiveSkills] = useState<Skill[]>([])
  const [activeAgent, setActiveAgent] = useState<ResolvedAgent | null>(null)
  const acRef = useRef<AbortController | null>(null)
  const [selAnchor, setSelAnchor] = useState<SelectionAnchor | undefined>()
  const [selActive, setSelActive] = useState<SelectionAnchor | undefined>()
  const selDragging = useRef(false)

  const pushLog = (line: string) => setLog((l) => [...l, line])

  function abortTurn() {
    const sid = sessionRef.current
    acRef.current?.abort()
    if (sid) void client.interrupt(sid).catch(() => {})
    pushLog("aborted turn")
  }

  const needKey = !hasResolvableKey()
  const slashMatches = filterSlashCommands(chrome.input)
  const slashOpen = !overlay && !busy && chrome.input.startsWith("/")
  const cols = stdout?.columns ?? 80
  const rows = stdout?.rows ?? 24
  const FOOTER_ROWS = 3
  const COMPOSER_ROWS = 3
  const streamH = Math.max(4, rows - FOOTER_ROWS - COMPOSER_ROWS)
  const t = theme()

  const shown = present({
    messages,
    live,
    sessionId,
    mode,
    skillNames: activeSkills.map((s) => s.name),
    connected: true,
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
    if (busySince === undefined) return
    const id = setInterval(() => setTick((n) => n + 1), 80)
    return () => clearInterval(id)
  }, [busySince])

  useEffect(() => {
    if (!stdout) return
    enableMouse(stdout)
    return () => disableMouse(stdout)
  }, [stdout])

  const smoothRef = useRef<{
    timer: ReturnType<typeof setInterval> | null
    start: number
    target: number
    startTime: number
    duration: number
    current: number
    contentLength: number
    viewHeight: number
  } | null>(null)

  const cancelSmooth = () => {
    if (smoothRef.current?.timer) clearInterval(smoothRef.current.timer)
    smoothRef.current = null
  }

  useEffect(() => cancelSmooth, [])

  useEffect(() => {
    if (overlay) cancelSmooth()
  }, [overlay])

  useEffect(() => {
    cancelSmooth()
  }, [streamH, cols])

  function smoothScroll(dir: "up" | "down", kind: "wheel" | "ctrl" | "page") {
    const contentLength = streamRows(shown.stream, cols)
    const viewHeight = streamH
    if (contentLength <= viewHeight) return
    const max = maxStart(contentLength, viewHeight)
    const step = scrollStep(kind, viewHeight)
    const delta = dir === "up" ? -step : step
    const currentRendered = smoothRef.current?.current ?? (chrome.followTail ? max : chrome.viewportOffset)
    const baseTarget = smoothRef.current?.target ?? currentRendered
    const target = clampOffset(baseTarget + delta, contentLength, viewHeight)
    const start = currentRendered
    if (target === baseTarget && target === currentRendered) {
      // already at edge - ensure followTail correctly set if at tail
      if (target >= max && !chrome.followTail) {
        setChrome((c) => ({ ...c, viewportOffset: target, followTail: true }))
      }
      return
    }
    // if target didn't move but we are animating, still need to handle followTail edge
    if (target === baseTarget) return
    const duration = kind === "wheel" ? 120 : kind === "ctrl" ? 150 : 180
    const startTime = Date.now()
    if (smoothRef.current?.timer) clearInterval(smoothRef.current.timer)
    smoothRef.current = { timer: null, start, target, startTime, duration, current: start, contentLength, viewHeight }
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(1, elapsed / duration)
      const next = interpolatedOffset(start, target, progress)
      if (smoothRef.current) smoothRef.current.current = next
      const atTail = next >= max
      setChrome((c) => ({ ...c, viewportOffset: next, followTail: atTail }))
      if (progress >= 1) {
        clearInterval(timer)
        smoothRef.current = null
      }
    }, 16)
    if (smoothRef.current) smoothRef.current.timer = timer
  }

  // keep legacy name for any external refs (now delegates to smooth with ctrl-sized step)
  function pageScroll(dir: "up" | "down") {
    smoothScroll(dir, "ctrl")
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
                      const model = loadConfig().model
                      void client
                        .updateConfig({
                          preset: preset.id,
                          provider: preset.adapter,
                          baseUrl: preset.baseUrl,
                          apiKey,
                          ...(model ? { model } : {}),
                        })
                        .then(() => {
                          setOverlay(null)
                          pushLog(`connected: ${preset.id}`)
                          setLive((s) => ({ ...s, status: { ...s.status, model: model || "?" } }))
                        })
                        .catch((error) => {
                          setOverlay(null)
                          pushLog(`connect failed: ${error instanceof Error ? error.message : String(error)}`)
                        })
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
            const model = loadConfig().model || preset.suggestedModels[0] || ""
            void client
              .updateConfig({
                preset: preset.id,
                apiKey: key,
                ...(preset.baseUrl ? { baseUrl: preset.baseUrl } : {}),
                ...(model ? { model } : {}),
              })
              .then(() => {
                setOverlay(null)
                pushLog(`connected: ${preset.label}`)
                setLive((s) => ({ ...s, status: { ...s.status, model: model || "?" } }))
              })
              .catch((error) => {
                setOverlay(null)
                pushLog(`connect failed: ${error instanceof Error ? error.message : String(error)}`)
              })
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
              const model = m.trim()
              void client
                .updateConfig({ model })
                .then(() => {
                  setOverlay(null)
                  pushLog(`model: ${model}`)
                  setLive((s) => ({ ...s, status: { ...s.status, model } }))
                })
                .catch((error) => {
                  setOverlay(null)
                  pushLog(`model update failed: ${error instanceof Error ? error.message : String(error)}`)
                })
            },
          })
          return
        }
        void client
          .updateConfig({ model: id })
          .then(() => {
            setOverlay(null)
            pushLog(`model: ${id}`)
            setLive((s) => ({ ...s, status: { ...s.status, model: id } }))
          })
          .catch((error) => {
            setOverlay(null)
            pushLog(`model update failed: ${error instanceof Error ? error.message : String(error)}`)
          })
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
    void client
      .skills()
      .then((list) => {
        const catalog = list as unknown as Skill[]
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
      })
      .catch((error) => pushLog(`skill discovery failed: ${error instanceof Error ? error.message : String(error)}`))
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
    void client
      .skills()
      .then((list) => {
        const skill = findSkill(list as unknown as Skill[], args)
        if (!skill) {
          pushLog(`unknown skill: ${args} — try /skill`)
          return
        }
        activateSkill(skill)
      })
      .catch((error) => pushLog(`skill discovery failed: ${error instanceof Error ? error.message : String(error)}`))
  }

  function startAgentFlow() {
    void client
      .agents()
      .then((list) => {
        const custom = list.filter((agent) => !agent.builtin) as Array<{
          id: string
          description?: string
          mode?: "plan" | "build"
          model?: string
          prompt?: string
          tools?: string[]
        }>
        if (custom.length === 0) {
          pushLog("no custom agents configured under agents in .nexus.json")
          return
        }
        setOverlay({
          kind: "picker",
          title: "Select custom agent (/agent)",
          searchable: true,
          items: [
            ...custom.map((agent) => ({
              id: agent.id,
              label: `${agent.id}${agent.description ? ` — ${agent.description}` : ""}`,
            })),
            ...(activeAgent ? [{ id: "__none__", label: "Clear custom agent" }] : []),
          ],
          then: (id) => {
            setOverlay(null)
            if (id === "__none__") {
              setActiveAgent(null)
              pushLog("custom agent cleared")
              return
            }
            const found = custom.find((agent) => agent.id === id)
            if (!found) return
            const agent: ResolvedAgent = {
              id: found.id,
              config: {
                ...(found.description ? { description: found.description } : {}),
                ...(found.mode ? { mode: found.mode } : {}),
                ...(found.model ? { model: found.model } : {}),
                ...(found.prompt ? { prompt: found.prompt } : {}),
                ...(found.tools ? { tools: found.tools } : {}),
              },
            }
            setActiveAgent(agent)
            if (agent.config.mode) setMode(agent.config.mode)
            pushLog(`agent: ${agent.id}`)
          },
        })
      })
      .catch((error) => pushLog(`agent list failed: ${error instanceof Error ? error.message : String(error)}`))
  }

  function startResumeFlow() {
    void (async () => {
      const sessions = (await client.listSessions()) as Array<{
        id: string
        title?: string
        model: string
        createdAt: string
      }>
      if (sessions.length === 0) {
        pushLog("no sessions to resume")
        return
      }
      setOverlay({
        kind: "picker",
        title: "Resume session",
        searchable: true,
        items: sessions.map((s) => ({
          id: s.id,
          label: s.title ? `${s.title} — ${s.model} · ${s.createdAt}` : `${s.id.slice(0, 8)}… ${s.model} ${s.createdAt}`,
          searchText: `${s.title ?? ""} ${s.id} ${s.model} ${s.createdAt}`,
        })),
        then: (id) => {
          void (async () => {
            try {
              const loaded = (await client.getSession(id)) as { model: string }
              const loadedMessages = (await client.messages(id)) as Message[]
              sessionRef.current = id
              setSessionId(id)
              setMessages(loadedMessages)
              setOverlay(null)
              setLog([])
              setChrome((c) => ({ ...initialChrome(), history: c.history.length ? c.history : loadHistory() }))
              setLive(initialTUIState(loaded.model))
            } catch (error) {
              pushLog(`resume failed: ${error instanceof Error ? error.message : String(error)}`)
            }
          })()
        },
      })
    })().catch((error) => pushLog(`resume failed: ${error instanceof Error ? error.message : String(error)}`))
  }

  async function runTurnUi(userText: string, opts: { agent?: ResolvedAgent } = {}) {
    const selectedAgent = opts.agent ?? activeAgent ?? undefined
    const agent = selectedAgent
      ? {
          ...(selectedAgent.config.prompt ? { prompt: selectedAgent.config.prompt } : {}),
          ...(selectedAgent.config.tools ? { tools: selectedAgent.config.tools } : {}),
          ...(selectedAgent.config.mode ? { mode: selectedAgent.config.mode } : {}),
        }
      : undefined
    setMessages((current) => [...current, { role: "user" as const, content: userText }])
    setBusy(true)
    setBusySince(Date.now())
    setLive(initialTUIState(selectedAgent?.config.model ?? (loadConfig().model || "?")))
    const ac = new AbortController()
    acRef.current = ac
    let sid = sessionRef.current
    try {
      if (!sid) {
        const session = (await client.createSession({
          cwd: process.cwd(),
          ...(selectedAgent?.config.model ? { model: selectedAgent.config.model } : {}),
        })) as { id: string }
        sid = String(session.id)
        sessionRef.current = sid
        setSessionId(sid)
      }
      const result = await client.prompt(sid, {
        text: userText,
        autoApprove: false,
        ...(agent?.mode ?? mode ? { mode: agent?.mode ?? mode } : {}),
        ...(activeSkills.length ? { skills: activeSkills } : {}),
        ...(agent ? { agent } : {}),
      })
      const terminal = await runServerTurn(client, {
        sessionID: sid,
        after: result.cursor,
        signal: ac.signal,
        onEvent: (event) => setLive((state) => reduceEvent(state, event)),
        onPermission: (request) =>
          new Promise<boolean>((resolve) =>
            setOverlay({
              kind: "permission",
              name: request.name,
              reason: request.reason,
              input: request.input,
              resolve: (ok) => {
                setOverlay(null)
                resolve(ok)
              },
            }),
          ),
        onQuestion: (_requestID, questions) =>
          new Promise((resolve) => {
            const ask = (
              index: number,
              answers: Array<{ header: string; question: string; answer: string }>,
            ): void => {
              if (index >= questions.length) {
                resolve(answers)
                return
              }
              const question = questions[index]
              setOverlay({
                kind: "line",
                label: `${question.header}: ${question.question} `,
                then: (answer) =>
                  ask(index + 1, [...answers, { header: question.header, question: question.question, answer }]),
              })
            }
            ask(0, [])
          }),
      })
      if (terminal) {
        setMessages((await client.messages(sid)) as Message[])
        setLive((state) => settleTurnView(state, terminal))
      }
    } catch (error) {
      if (ac.signal.aborted) {
        setLive((s) => settleTurnView(s, { type: "aborted" }))
      } else {
        pushLog(`turn failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      ac.abort()
      setBusy(false)
      setBusySince(undefined)
      acRef.current = null
      if (sid) {
        try {
          setMessages((await client.messages(sid)) as Message[])
        } catch {
          /* session may have been removed */
        }
      }
    }
  }

  function handleSlash(raw: string) {
    const cmd = parseSlash(raw)
    if (cmd === "help") {
      const custom = configuredCommands(loadConfig())
      pushLog(
        custom.length
          ? `${HELP}\n\ncustom:\n${custom.map((c) => `/${c.name.padEnd(7)} ${c.description ?? c.template.slice(0, 60)}`).join("\n")}`
          : HELP,
      )
    } else if (cmd === "quit" || cmd === "exit") exit()
    else if (cmd === "key") startKeyFlow()
    else if (cmd === "model") startModelFlow()
    else if (cmd === "agent") startAgentFlow()
    else if (cmd === "skill" || cmd === "skills") handleSkillCommand(parseSlashArgs(raw))
    else if (cmd === "resume") startResumeFlow()
    else if (cmd === "plan") {
      setMode("plan")
      pushLog("mode: plan (read-only)")
    } else if (cmd === "build") {
      setMode("build")
      pushLog("mode: build")
    } else if (cmd === "new") {
      sessionRef.current = ""
      setSessionId("")
      setMessages([])
      setActiveSkills([])
      setActiveAgent(null)
      setLog([])
      setChrome((c) => ({ ...initialChrome(), history: c.history }))
      setLive(initialTUIState(loadConfig().model || "?"))
    } else {
      const cfg = loadConfig()
      const custom = findCommand(cfg, cmd)
      if (custom) {
        const args = parseSlashArgs(raw)
        const agent = custom.agent ? findAgent(cfg, custom.agent) : undefined
        if (custom.agent && !agent) {
          pushLog(`unknown agent: ${custom.agent} — command /${custom.name} not run`)
          return
        }
        const text = expandCommand(custom.template, args)
        if (!text) {
          pushLog(`command /${custom.name} expanded to an empty prompt`)
          return
        }
        void runTurnUi(text, agent ? { agent } : {})
        return
      }
      void client
        .skills()
        .then((list) => {
          const skill = findSkill(list as unknown as Skill[], cmd)
          if (skill) activateSkill(skill)
          else pushLog(`unknown command: /${cmd} — type / for options`)
        })
        .catch((error) =>
          pushLog(`skill discovery failed: ${error instanceof Error ? error.message : String(error)}`),
        )
    }
  }

  useInput((ch, key) => {
    const mouse = parseMouseEvent(ch)

    // Wheel scroll - line-by-line smooth 
    if (mouse?.type === "wheel") {
      if (mouse.button === 4) smoothScroll("up", "wheel")
      else smoothScroll("down", "wheel")
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
      if (busy && acRef.current) abortTurn()
      else exit()
      return
    }

    if (key.pageUp) {
      smoothScroll("up", "page")
      return
    }
    if (key.pageDown) {
      smoothScroll("down", "page")
      return
    }
    if (key.ctrl && (ch === "u" || ch === "\x15")) {
      smoothScroll("up", "ctrl")
      return
    }
    if (key.ctrl && (ch === "d" || ch === "\x04")) {
      smoothScroll("down", "ctrl")
      return
    }

    // Shift+Tab: toggle plan/build mode (works even with text in input)
    if (key.tab && key.shift && !busy && !overlay) {
      setMode((m) => (m === "plan" ? "build" : "plan"))
      return
    }

    // Steering: Enter during a Turn queues the line for the next safe boundary.
    if (busy && key.return) {
      const line = chrome.input.trim()
      if (!line) return
      setChrome((c) => reduceChrome(c, { type: "commitUser" }))
      if (line.startsWith("/")) {
        pushLog("slash commands are unavailable during a Turn — queued as steering instead")
      }
      const sid = sessionRef.current
      if (!sid) return
      void client
        .prompt(sid, { text: line, ...(mode ? { mode } : {}) })
        .then(() => pushLog("queued — applied at the next step"))
        .catch((error) => pushLog(`could not queue steering input: ${String(error)}`))
      setMessages((current) => [...current, { role: "user", content: line }])
      try {
        appendHistory(line)
      } catch {
        /* history persist is best-effort */
      }
      return
    }

    if (busy) {
      // Editing stays live during a Turn so the next line can be queued.
      if (key.backspace) {
        setChrome((c) => reduceChrome(c, { type: "backspace" }))
        return
      }
      if (key.delete) {
        setChrome((c) => reduceChrome(c, { type: "delete" }))
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
      if (key.ctrl || key.meta) return
      if (ch.startsWith("\x1b") || ch.startsWith("[<")) return
      if (ch) setChrome((c) => reduceChrome(c, { type: "insert", ch }))
      return
    }

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
      if (line) {
        try {
          appendHistory(line)
        } catch {
          /* history persist is best-effort */
        }
        void runTurnUi(line)
      }
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
            historyLen={shown.composer.historyLen}
            t={t}
          />
        )}
      </Box>
      <Box marginTop={1}>
        <Footer footer={shown.footer} cols={cols} t={t} />
      </Box>
      {busy ? (
        <Box>
          <Text color={t.boneDim}>
            {(() => {
              const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
              return frames[tick % frames.length]
            })()}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}
