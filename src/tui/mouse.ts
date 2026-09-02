export interface MouseEvent {
  type: "press" | "release" | "drag" | "wheel"
  button: number
  col: number
  row: number
}

export type MouseInput = "up" | "down" | "ignore"

/** Parse SGR mouse events. Extracts button, column, row. */
export function parseMouseInput(input: string): MouseInput | null {
  const sgr = /^(?:\x1b)?\[<(\d+);(\d+);(\d+)[mM]/.exec(input)
  if (sgr) {
    const btn = Number(sgr[1])
    if (btn === 64) return "up"
    if (btn === 65) return "down"
    return "ignore"
  }
  if (/^(?:\x1b)?\[M[\x20-\xfb]{3}/.test(input)) return "ignore"
  return null
}

/** Parse SGR mouse into structured event with coordinates. Returns null for non-mouse input. */
export function parseMouseEvent(input: string): MouseEvent | null {
  const sgr = /^(?:\x1b)?\[<(\d+);(\d+);(\d+)[mM]/.exec(input)
  if (!sgr) {
    if (/^(?:\x1b)?\[M[\x20-\xfb]{3}/.test(input)) return null
    return null
  }

  const rawBtn = Number(sgr[1])
  const col = Number(sgr[2]) - 1 // 0-indexed
  const row = Number(sgr[3]) - 1 // 0-indexed
  const isRelease = input.endsWith("m")
  const isMotion = (rawBtn & 32) !== 0
  const button = rawBtn & 3 // bits 0-1 = button (0=left, 1=middle, 2=right)
  const isWheel = (rawBtn & 64) !== 0

  if (isWheel) {
    return { type: "wheel", button: rawBtn === 64 ? 4 : 5, col, row }
  }
  if (isMotion) {
    return { type: "drag", button, col, row }
  }
  if (isRelease) {
    return { type: "release", button, col, row }
  }
  return { type: "press", button, col, row }
}

export function enableMouse(stdout: NodeJS.WriteStream): void {
  if (!stdout.isTTY) return
  // Enable X10 basic tracking, any-event tracking (for drag), and SGR extended mode
  stdout.write("\x1b[?1000h\x1b[?1003h\x1b[?1006h")
}

export function disableMouse(stdout: NodeJS.WriteStream): void {
  if (!stdout.isTTY) return
  stdout.write("\x1b[?1000l\x1b[?1003l\x1b[?1006l")
}
