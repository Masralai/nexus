import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const IGNORED_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "target", ".venv", "__pycache__"])
const MAX_SCAN_FILES = 50_000

export function isGitRepo(cwd: string): boolean {
  try {
    const proc = Bun.spawnSync(["git", "rev-parse", "--is-inside-work-tree"], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    })
    return proc.exitCode === 0 && proc.stdout.toString().trim() === "true"
  } catch {
    return false
  }
}

/**
 * Tracked and untracked (non-ignored) files. Git's own matcher gives glob,
 * grep and list consistent gitignore semantics without a second config.
 */
export function gitFiles(cwd: string): string[] | undefined {
  if (!isGitRepo(cwd)) return undefined
  try {
    const proc = Bun.spawnSync(["git", "ls-files", "-co", "--exclude-standard", "-z"], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    })
    if (proc.exitCode !== 0) return undefined
    return proc.stdout
      .toString()
      .split("\0")
      .filter(Boolean)
  } catch {
    return undefined
  }
}

function fallbackWalk(root: string, out: string[], rel = ""): void {
  if (out.length >= MAX_SCAN_FILES) return
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(join(root, rel), { withFileTypes: true }) as unknown as ReturnType<typeof readdirSync>
  } catch {
    return
  }
  for (const entry of entries as unknown as Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>) {
    if (entry.name.startsWith(".")) continue
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
    const next = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) fallbackWalk(root, out, next)
    else if (entry.isFile()) out.push(next)
  }
}

export function allFiles(cwd: string, opts: { includeHidden?: boolean } = {}): string[] {
  const git = gitFiles(cwd)
  if (git) {
    return opts.includeHidden ? git : git.filter((f) => !f.split("/").some((part) => part.startsWith(".")))
  }
  const out: string[] = []
  fallbackWalk(cwd, out)
  return opts.includeHidden ? out : out.filter((f) => !f.split("/").some((part) => part.startsWith(".")))
}

/** True for files that look binary or are too large to search safely. */
export function isBinaryLike(file: string, maxBytes = 2_000_000): boolean {
  try {
    const st = statSync(file)
    if (!st.isFile() || st.size > maxBytes) return true
    const fd = readFileSync(file)
    const n = Math.min(fd.length, 4096)
    for (let i = 0; i < n; i++) if (fd[i] === 0) return true
    return false
  } catch {
    return true
  }
}

export function displayPath(cwd: string, file: string): string {
  return relative(cwd, resolve(cwd, file)).split("\\").join("/") || file
}

export function entryKind(full: string): "dir" | "file" | "other" {
  try {
    const st = statSync(full)
    if (st.isDirectory()) return "dir"
    if (st.isFile()) return "file"
    return "other"
  } catch {
    return "other"
  }
}
