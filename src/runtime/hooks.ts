import { extname } from "node:path"
import type { CommandHookConfig } from "../cli/config"

function commandFor(cfg: CommandHookConfig, file: string): string[] {
  if (Array.isArray(cfg.command)) {
    const args = cfg.command.map((part) => part.replaceAll("{file}", file))
    return args.some((part) => part.includes(file)) ? args : [...args, file]
  }
  const command = cfg.command.replaceAll("{file}", file)
  return ["bash", "-lc", command.includes(file) ? command : `${command} ${JSON.stringify(file)}`]
}

async function runHook(
  cfg: CommandHookConfig,
  cwd: string,
  file: string,
): Promise<{ code: number; output: string }> {
  const proc = Bun.spawn(commandFor(cfg, file), {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })
  const timer = setTimeout(() => {
    try {
      proc.kill()
    } catch {
      /* ignore */
    }
  }, 30_000)
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const code = await proc.exited
  clearTimeout(timer)
  return { code, output: `${out}${err}`.trim() }
}

/**
 * Run configured formatters and diagnostics after successful edits. Failures
 * are returned to the model as tool output rather than swallowed.
 */
export function createAfterEdit(
  config: { formatters?: Record<string, CommandHookConfig>; diagnostics?: Record<string, CommandHookConfig> },
  cwd: string,
): ((paths: string[]) => Promise<string[]>) | undefined {
  const formatters = Object.values(config.formatters ?? {})
  const diagnostics = Object.values(config.diagnostics ?? {})
  if (formatters.length === 0 && diagnostics.length === 0) return undefined
  return async (paths: string[]) => {
    const notes: string[] = []
    for (const path of paths) {
      const ext = extname(path)
      for (const formatter of formatters) {
        if (formatter.extensions && !formatter.extensions.includes(ext)) continue
        const result = await runHook(formatter, cwd, path)
        if (result.code !== 0) notes.push(`[format:${path}] ${result.output || `exit ${result.code}`}`)
      }
      for (const diagnostic of diagnostics) {
        if (diagnostic.extensions && !diagnostic.extensions.includes(ext)) continue
        const result = await runHook(diagnostic, cwd, path)
        if (result.code !== 0) notes.push(`[diagnostics:${path}] ${result.output || `exit ${result.code}`}`)
        else if (result.output) notes.push(`[diagnostics:${path}] ${result.output}`)
      }
    }
    return notes
  }
}
