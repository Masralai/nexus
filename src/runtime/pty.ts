import { randomUUID } from "node:crypto"
import type { PtyControl, PtyCreateOptions, PtyInfo } from "../engine/types"

interface Shell {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  proc: ReturnType<typeof Bun.spawn>
  terminal: Bun.Terminal
  buffer: string
  waiters: Array<{ marker: string; resolve: (r: { output: string; exitCode: number }) => void; timer: ReturnType<typeof setTimeout> }>
  closed: boolean
  exitCode?: number
}

const DEFAULT_TIMEOUT = 30_000

/** Strip terminal echo and ANSI control sequences from captured PTY output. */
function clean(text: string, command: string, marker: string): string {
  let out = text.replace(/\r/g, "")
  // Remove common CSI/OSC sequences.
  out = out.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
  const lines = out
    .split("\n")
    // The terminal echoes the `printf` marker command before running it.
    .filter((line) => !line.includes(marker))
    // Bash prints these when the pty is not a controlling terminal (CI, pipes).
    .filter((line) => !/^bash: cannot set terminal process group/.test(line.trim()))
    .filter((line) => !/^bash: no job control in this shell$/.test(line.trim()))
  // Drop the echoed command (it can arrive twice: tty echo and shell echo).
  while (lines.length > 0 && (lines[0].trim() === "" || lines[0].trim() === command.trim())) lines.shift()
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop()
  return lines.join("\n")
}

function shellFor(
  shells: Map<string, Shell>,
  key: string,
  cwd: string,
  opts: PtyCreateOptions = {},
): Shell {
  const existing = shells.get(key)
  if (existing && !existing.closed) return existing
  if (existing) shells.delete(key)
  const bufferRef = { value: "" }
  const pending: Shell["waiters"] = []
  const terminal = new Bun.Terminal({
    cols: 120,
    rows: 40,
    data(_term, data) {
      const text = new TextDecoder().decode(data)
      bufferRef.value += text
      for (const waiter of [...pending]) {
        // The terminal echoes the command, so the marker appears twice: once in
        // the echoed `printf` line (followed by `%s`) and once in the output
        // (followed by the exit code). Only the latter is a real completion.
        const pattern = new RegExp(`${waiter.marker}:(\\d+)`, "g")
        let match: RegExpExecArray | null
        let found: RegExpExecArray | null = null
        while ((match = pattern.exec(bufferRef.value))) found = match
        if (!found) continue
        const idx = found.index
        const exitCode = Number(found[1])
        pending.splice(pending.indexOf(waiter), 1)
        clearTimeout(waiter.timer)
        const output = bufferRef.value.slice(0, idx)
        bufferRef.value = bufferRef.value.slice(idx + found[0].length)
        waiter.resolve({ output, exitCode })
      }
    },
  })
  const command = opts.command ?? "bash"
  const args = opts.args ?? (opts.command ? [] : ["--noprofile", "--norc"])
  const proc = Bun.spawn([command, ...args], {
    cwd,
    terminal,
    env: {
      ...process.env,
      ...opts.env,
      PS1: "",
      PS2: "",
      TERM: process.env.TERM || "xterm-256color",
    },
  })
  const shell: Shell = {
    id: key,
    title: opts.title ?? command,
    command,
    args,
    cwd,
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
  proc.exited.then((code) => {
    shell.closed = true
    shell.exitCode = code
    for (const waiter of pending.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.resolve({ output: bufferRef.value, exitCode: 1 })
    }
  })
  shells.set(key, shell)
  return shell
}

function info(shell: Shell): PtyInfo {
  return {
    id: shell.id,
    title: shell.title,
    command: shell.command,
    args: shell.args,
    cwd: shell.cwd,
    status: shell.closed ? "exited" : "running",
    pid: shell.proc.pid,
    ...(shell.exitCode !== undefined ? { exitCode: shell.exitCode } : {}),
  }
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

    try {
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
      const output = clean(raw, command, marker)
      if (output) opts.onOutput?.(output)
      return { output, exitCode: result.exitCode }
    } finally {
      // Always hand the PTY to the next queued command, including on timeout.
      release()
    }
  }

  create(id: string, opts: PtyCreateOptions = {}): PtyInfo {
    return info(shellFor(this.shells, id, opts.cwd ?? process.cwd(), opts))
  }

  list(): PtyInfo[] {
    return [...this.shells.values()].map(info)
  }

  get(id: string): PtyInfo | undefined {
    const shell = this.shells.get(id)
    return shell ? info(shell) : undefined
  }

  update(id: string, opts: { title?: string; rows?: number; cols?: number }): PtyInfo {
    const shell = this.shells.get(id)
    if (!shell) throw new Error(`pty ${id} not found`)
    if (opts.title !== undefined) shell.title = opts.title
    if (opts.rows !== undefined && opts.cols !== undefined) shell.terminal.resize(opts.cols, opts.rows)
    return info(shell)
  }

  write(id: string, data: string): void {
    const shell = this.shells.get(id)
    if (!shell || shell.closed) throw new Error(`pty ${id} is not running`)
    shell.terminal.write(data)
  }

  output(id: string, offset = 0): { data: string; offset: number } {
    const shell = this.shells.get(id)
    if (!shell) throw new Error(`pty ${id} not found`)
    const start = Math.max(0, Math.min(offset, shell.buffer.length))
    return { data: shell.buffer.slice(start), offset: shell.buffer.length }
  }

  remove(id: string): void {
    this.close(id)
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
