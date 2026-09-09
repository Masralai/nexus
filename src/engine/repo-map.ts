import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export interface RepoMapOptions {
  maxFiles?: number
  maxBytes?: number
}

function loadIgnorePatterns(cwd: string): string[] {
  const baseIgnores = ["**/node_modules/**", "**/.git/**", "**/.next/**", "**/dist/**", "**/coverage/**", "**/.turbo/**"]
  const extra: string[] = []
  for (const name of [".gitignore", ".ignore"]) {
    const p = join(cwd, name)
    if (!existsSync(p)) continue
    try {
      const raw = readFileSync(p, "utf8").split("\n")
      for (let line of raw) {
        line = line.trim()
        if (!line || line.startsWith("#")) continue
        // handle negation ! -> we skip for now (allowlist not in fast-glob ignore)
        if (line.startsWith("!")) continue
        // normalize dir patterns
        if (line.endsWith("/")) line = line + "**"
        extra.push(line)
      }
    } catch { /* ignore */ }
  }
  return [...baseIgnores, ...extra]
}

export async function buildRepoMap(cwd: string, opts: RepoMapOptions = {}): Promise<string> {
  const maxFiles = opts.maxFiles ?? 2000
  const ignores = loadIgnorePatterns(cwd)
  try {
    const fg = await import("fast-glob")
    const entries = (await fg.default("**/*", {
      cwd,
      dot: false,
      onlyFiles: true,
      ignore: ignores,
      suppressErrors: true,
    })) as string[]
    const sorted = entries.sort()
    const sliced = sorted.slice(0, maxFiles)
    const more = sorted.length > maxFiles ? ` (+${sorted.length - maxFiles} more)` : ""
    if (sliced.length === 0) return "Repo map: empty"
    // group by top-level dir for readability
    const preview = sliced.slice(0, 120).join(", ")
    const suffix = sliced.length > 120 ? `, ... +${sliced.length - 120} more` : ""
    return `Repo map (${sorted.length} files${more}): ${preview}${suffix}`
  } catch {
    return "Repo map: unavailable"
  }
}
