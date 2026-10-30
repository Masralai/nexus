import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import type { WorktreeControl, WorktreeEntry } from "../engine/types"
import { defaultStateDir } from "../server/state"

interface WorktreeStore {
  recordWorktree?(directory: string, strategy?: string): void
  forgetWorktree?(directory: string): void
}

interface GitResult {
  code: number
  stdout: string
  stderr: string
}

function git(cwd: string, args: string[]): GitResult {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    code: proc.exitCode ?? 1,
    stdout: proc.stdout.toString().trim(),
    stderr: proc.stderr.toString().trim(),
  }
}

function repoRoot(cwd: string): string {
  const result = git(cwd, ["rev-parse", "--show-toplevel"])
  if (result.code !== 0 || !result.stdout) {
    throw new Error(`not a git repository: ${cwd}`)
  }
  return result.stdout
}

function branchExists(root: string, branch: string): boolean {
  return git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).code === 0
}

/** Slugs are safe for both a directory name and a git branch component. */
function slug(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return cleaned || `worktree-${randomBytes(3).toString("hex")}`
}

function uniqueName(root: string, base: string, directoryFor: (name: string) => string): string {
  let name = base
  for (let suffix = 2; suffix <= 50; suffix++) {
    if (!existsSync(directoryFor(name)) && !branchExists(root, `nexus/${name}`)) return name
    name = `${base}-${suffix}`
  }
  throw new Error(`could not find an unused worktree name for ${base}`)
}

function parseList(output: string, root: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  for (const block of output.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter(Boolean)
    const directory = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length)
    if (!directory) continue
    const commit = lines.find((line) => line.startsWith("HEAD "))?.slice("HEAD ".length)
    const branchLine = lines.find((line) => line.startsWith("branch "))
    const branch = branchLine?.slice("branch ".length).replace(/^refs\/heads\//, "")
    entries.push({
      directory,
      ...(branch ? { branch } : {}),
      ...(commit ? { commit } : {}),
      ...(resolve(directory) === resolve(root) ? { root: true } : {}),
    })
  }
  return entries
}

/**
 * Git worktree isolation. Each worktree gets its own branch, lives outside the
 * repository by default, and is recorded in the durable worktrees table.
 */
export class WorktreeManager implements WorktreeControl {
  constructor(
    private readonly cwd: string,
    private readonly store?: WorktreeStore,
    private readonly baseDir = join(defaultStateDir(), "worktrees"),
  ) {}

  async create(input: { name?: string; branch?: string; from?: string; directory?: string } = {}) {
    const root = repoRoot(this.cwd)
    const requested = input.name ? slug(input.name) : undefined
    const directoryFor = (name: string) =>
      input.directory ? resolve(this.cwd, input.directory) : join(this.baseDir, slug(basename(root)), name)
    if (input.directory && existsSync(directoryFor(requested ?? ""))) {
      throw new Error(`worktree destination already exists: ${directoryFor(requested ?? "")}`)
    }

    const name = requested
      ? uniqueName(root, requested, directoryFor)
      : uniqueName(root, `worktree-${randomBytes(3).toString("hex")}`, directoryFor)
    const branch = input.branch?.trim() || `nexus/${name}`
    if (branchExists(root, branch)) throw new Error(`branch already exists: ${branch}`)

    const directory = directoryFor(name)
    if (existsSync(directory)) throw new Error(`worktree destination already exists: ${directory}`)
    mkdirSync(dirname(directory), { recursive: true })

    const args = ["worktree", "add", "-b", branch, directory]
    if (input.from?.trim()) args.push(input.from.trim())
    const result = git(root, args)
    if (result.code !== 0) {
      throw new Error(`git worktree add failed: ${result.stderr || result.stdout || `exit ${result.code}`}`)
    }

    this.store?.recordWorktree?.(directory, "git")
    return { directory, branch }
  }

  async list(): Promise<WorktreeEntry[]> {
    const root = repoRoot(this.cwd)
    const result = git(root, ["worktree", "list", "--porcelain"])
    if (result.code !== 0) throw new Error(`git worktree list failed: ${result.stderr || `exit ${result.code}`}`)
    return parseList(result.stdout, root)
  }

  async remove(input: { directory: string; force?: boolean }): Promise<void> {
    const root = repoRoot(this.cwd)
    const directory = resolve(this.cwd, input.directory)
    const entries = await this.list()
    const entry = entries.find((item) => resolve(item.directory) === directory)
    if (!entry) throw new Error(`not a worktree of ${root}: ${directory}`)
    if (entry.root) throw new Error(`refusing to remove the repository's main worktree: ${directory}`)

    const args = ["worktree", "remove"]
    if (input.force) args.push("--force")
    args.push(directory)
    let result = git(root, args)
    // A locked or dirty worktree needs force twice; surface the original error
    // when the caller did not ask for it.
    if (result.code !== 0 && input.force) result = git(root, ["worktree", "remove", "--force", "--force", directory])
    if (result.code !== 0) {
      throw new Error(`git worktree remove failed: ${result.stderr || result.stdout || `exit ${result.code}`}`)
    }
    git(root, ["worktree", "prune"])
    this.store?.forgetWorktree?.(directory)
  }
}
