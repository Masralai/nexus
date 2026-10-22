import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"

export interface InstructionFile {
  path: string
  content: string
}

export interface DiscoverOptions {
  cwd: string
  /** Additional files or URLs from config. Relative paths resolve against cwd. */
  extra?: string[]
  /** Global instruction directory. Defaults to ~/.nexus. */
  globalDir?: string
  /** Include user-level (~/.nexus, ~/.agents) instructions. Defaults to true. */
  includeUser?: boolean
  /** Skip any single file larger than this. */
  maxBytes?: number
}

const MAX_BYTES = 64 * 1024
const MAX_FILES = 40
const MAX_DEPTH = 8
const MAX_TOTAL = 96 * 1024

function readIfFile(path: string, maxBytes: number): string | undefined {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return undefined
    if (statSync(path).size > maxBytes) return undefined
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

/** Import lines: `@path/to/file` on its own line. */
function importTargets(content: string): string[] {
  const out: string[] = []
  for (const line of content.split("\n")) {
    const match = /^\s*@(\S+)\s*$/.exec(line)
    if (match) out.push(match[1])
  }
  return out
}

function expand(file: string, maxBytes: number, seen: Set<string>, depth: number): InstructionFile[] {
  if (depth > MAX_DEPTH) return []
  const path = resolve(file)
  if (seen.has(path)) return []
  seen.add(path)
  const content = readIfFile(path, maxBytes)
  if (content === undefined) return []
  const files: InstructionFile[] = [{ path, content }]
  for (const target of importTargets(content)) {
    if (/^https?:\/\//.test(target)) continue
    const next = isAbsolute(target) ? target : join(dirname(path), target)
    files.push(...expand(next, maxBytes, seen, depth + 1))
  }
  return files
}

/** Nearest repository root, or cwd when there is no VCS boundary. */
function projectRoot(cwd: string): string {
  let dir = resolve(cwd)
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir
    const parent = dirname(dir)
    if (parent === dir) return resolve(cwd)
    dir = parent
  }
}

function ancestors(cwd: string): string[] {
  const root = projectRoot(cwd)
  const dirs: string[] = []
  let dir = resolve(cwd)
  while (true) {
    dirs.push(dir)
    if (dir === root) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return dirs.reverse()
}

/**
 * Layered instruction discovery.
 *
 * Global instructions first, then project files from the repository root toward
 * the working directory, so nearer files win by appearing later in the prompt.
 * Imports are resolved recursively with cycle detection and deduplication.
 */
export function discoverInstructions(opts: DiscoverOptions): InstructionFile[] {
  const maxBytes = opts.maxBytes ?? MAX_BYTES
  const seen = new Set<string>()
  const files: InstructionFile[] = []
  let total = 0
  const add = (path: string) => {
    for (const file of expand(path, maxBytes, seen, 0)) {
      if (files.length >= MAX_FILES || total >= MAX_TOTAL) return
      const remaining = MAX_TOTAL - total
      const content =
        file.content.length > remaining
          ? `${file.content.slice(0, remaining)}\n[...instructions truncated]`
          : file.content
      files.push({ ...file, content })
      total += content.length
    }
  }

  if (opts.includeUser ?? true) {
    const globalDir = opts.globalDir ?? join(homedir(), ".nexus")
    add(join(globalDir, "AGENTS.md"))
    add(join(homedir(), ".agents", "AGENTS.md"))
  }

  for (const dir of ancestors(opts.cwd)) add(join(dir, "AGENTS.md"))
  add(join(opts.cwd, ".nexus", "AGENTS.md"))

  for (const extra of opts.extra ?? []) {
    if (/^https?:\/\//.test(extra)) continue
    add(isAbsolute(extra) ? extra : resolve(opts.cwd, extra))
  }
  return files
}

/**
 * Discovery plus configured URLs. URLs are fetched with a short timeout and
 * included after local files so a remote failure never blocks a turn.
 */
export async function discoverInstructionsWithUrls(
  opts: DiscoverOptions & { fetchImpl?: typeof fetch },
): Promise<InstructionFile[]> {
  const extra = opts.extra ?? []
  const files = discoverInstructions({
    ...opts,
    extra: extra.filter((item) => !/^https?:\/\//.test(item)),
  })
  const remote = extra.filter((item) => /^https?:\/\//.test(item))
  for (const url of remote) {
    try {
      const fetchImpl = opts.fetchImpl ?? fetch
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) })
      if (!res.ok) continue
      const text = (await res.text()).slice(0, MAX_BYTES)
      files.push({ path: url, content: text })
    } catch {
      /* remote instructions are optional */
    }
  }
  return files
}

export function formatInstructions(files: readonly InstructionFile[]): string {
  return files
    .map((file) => `<instructions path="${file.path}">\n${file.content.trim()}\n</instructions>`)
    .join("\n\n")
}
