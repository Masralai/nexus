import { randomUUID } from "node:crypto"
import type { PtyControl } from "../engine/types"

interface Shell {
  proc: ReturnType<typeof Bun.spawn>
  terminal: Bun.Terminal
  buffer: string
  waiters: Array<{ marker: string; resolve: (r: { output: string; exitCode: number }) => void; timer: ReturnType<typeof setTimeout> }>
  closed: boolean
}

const DEFAULT_TIMEOUT = 30_000

/** Strip terminal echo and ANSI control sequences from captured PTY output. */
function clean(text: string, command: string): string {
  let out = text.replace(/\r/g, "")
  // The first line is usually the shell echoing the command.
  const lines = out.split("\n")
  if (lines[0]?.trim() === command.trim()) lines.shift()
  out = lines.join("\n")
  // Remove common CSI/OSC sequences.
  out = out.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
  return out.replace(/^\n+/, "").replace(/\n+$/, "")
}

function shellFor(shells: Map<string, Shell>, key: string, cwd: string): Shell {
  const existing = shells.get(key)
  if (existing && !existing.closed) return existing
  const bufferRef = { value: "" }
  const pending: Shell["waiters"] = []
  const terminal = new Bun.Terminal({
    cols: 120,
    rows: 40,
    data(_term, data) {
      const text = new TextDecoder().decode(data)
      bufferRef.value += text
      for (const waiter of [...pending]) {
        const idx = bufferRef.value.indexOf(waiter.marker)
        if (idx === -1) continue
        const tail = bufferRef.value.slice(idx + waiter.marker.length)
        const codeMatch = /^:(\d+)/.exec(tail)
        if (!codeMatch) continue
        pending.splice(pending.indexOf(waiter), 1)
        clearTimeout(waiter.timer)
        const output = bufferRef.value.slice(0, idx)
        const exitCode = Number(codeMatch[1])
        bufferRef.value = tail.slice(codeMatch[0].length)
        waiter.resolve({ output, exitCode })
      }
    },
  })
  const proc = Bun.spawn(["bash", "--noprofile", "--norc"], {
    cwd,
    terminal,
    env: {
      ...process.env,
      PS1: "",
      PS2: "",
      TERM: process.env.TERM || "xterm-256color",
    },
  })
  const shell: Shell = {
    proc,
    terminal,
    get buffer() {
      return bufferRef.value
    },
    set buffer(value: string) {
      bufferRef.value = value
    },
    waiters: pending,
    closed: false,
  }
  proc.exited.then(() => {
    shell.closed = true
    for (const waiter of pending.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.resolve({ output: bufferRef.value, exitCode: 1 })
    }
  })
  shells.set(key, shell)
  return shell
}

/** Persistent shell per session: cwd and exported environment survive commands. */
export class PtyManager implements PtyControl {
  private shells = new Map<string, Shell>()

  async run(
    sessionId: string,
    command: string,
    opts: { cwd?: string; timeoutMs?: number; onOutput?: (chunk: string) => void } = {},
  ): Promise<{ output: string; exitCode: number }> {
    const shell = shellFor(this.shells, sessionId, opts.cwd ?? process.cwd())
    const marker = `__NEXUS_DONE_${randomUUID().replace(/-/g, "")}`
    // Serialize commands written to the same PTY. Without this, two parallel
    // tool calls would interleave markers and corrupt each other's output.
    const previous = (shell as unknown as { queue?: Promise<unknown> }).queue ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    ;(shell as unknown as { queue?: Promise<unknown> }).queue = previous.then(() => gate)
    await previous

    const start = shell.buffer.length
    const done = new Promise<{ output: string; exitCode: number }>((resolve, reject) => {
      const waiter = {
        marker,
        resolve,
        timer: setTimeout(() => {
          shell.waiters.splice(shell.waiters.indexOf(waiter), 1)
          try {
            shell.terminal.write("\x03")
          } catch {
            /* closed */
          }
          reject(new Error(`command timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT}ms`))
        }, opts.timeoutMs ?? DEFAULT_TIMEOUT),
      }
      shell.waiters.push(waiter)
    })

    const before = shell.buffer.length
    shell.terminal.write(`${command}\nprintf '\\n${marker}:%s\\n' "$?"\n`)
    // Some commands emit output before the marker is registered in the next
    // microtask. The waiter owns all output since the write boundary.
    const result = await done
    const raw = result.output.length >= before ? result.output : shell.buffer.slice(start)
    const output = clean(raw, command)
    if (output) opts.onOutput?.(output)
    return { output, exitCode: result.exitCode }
  }

  close(sessionId?: string): void {
    const keys = sessionId ? [sessionId] : [...this.shells.keys()]
    for (const key of keys) {
      const shell = this.shells.get(key)
      if (!shell) continue
      try {
        shell.terminal.close()
      } catch {
        /* already closed */
      }
      try {
        shell.proc.kill()
      } catch {
        /* already dead */
      }
      this.shells.delete(key)
    }
  }
}
