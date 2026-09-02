import { execSync } from "node:child_process"

/** Copy text to system clipboard using OSC 52 or fallback to clipboard utilities. */
export function copyToClipboard(text: string, stdout: NodeJS.WriteStream): boolean {
  if (!stdout.isTTY) return false

  // Try OSC 52 first (works in most modern terminals)
  if (tryOSC52(text, stdout)) return true

  // Fallback to platform clipboard utilities
  return tryFallback(text)
}

function tryOSC52(text: string, stdout: NodeJS.WriteStream): boolean {
  try {
    const b64 = Buffer.from(text).toString("base64")
    // OSC 52: ESC ] 52 ; c ; <base64> ESC backslash
    // The 'c' selects clipboard (c = clipboard, p = primary, s = select, 0-9 = cut buffers)
    stdout.write(`\x1b]52;c;${b64}\x1b\\`)
    return true
  } catch {
    return false
  }
}

function tryFallback(text: string): boolean {
  try {
    const platform = process.platform
    if (platform === "darwin") {
      execSync("pbcopy", { input: text, timeout: 1000 })
      return true
    } else if (platform === "linux") {
      // Try xclip, then xsel
      try {
        execSync("xclip -selection clipboard", { input: text, timeout: 1000 })
        return true
      } catch {
        execSync("xsel --clipboard --input", { input: text, timeout: 1000 })
        return true
      }
    } else if (platform === "win32") {
      execSync("clip", { input: text, timeout: 1000 })
      return true
    }
  } catch {
    // Clipboard utility not available
  }
  return false
}
