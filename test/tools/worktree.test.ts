import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "../../src/engine/types"
import { WorktreeManager } from "../../src/runtime/worktree"
import { worktree_create, worktree_list, worktree_remove } from "../../src/tools/worktree"

function git(cwd: string, args: string[]): void {
  const proc = Bun.spawnSync(
    ["git", "-c", "user.email=test@example.com", "-c", "user.name=Nexus Test", ...args],
    { cwd, stdout: "pipe", stderr: "pipe" },
  )
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString())
}

function repo(): { root: string; base: string; ctx: ToolContext } {
  const root = mkdtempSync(join(tmpdir(), "nexus-worktree-"))
  const base = mkdtempSync(join(tmpdir(), "nexus-worktrees-store-"))
  git(root, ["init", "-q"])
  writeFileSync(join(root, "README.md"), "hello\n")
  git(root, ["add", "README.md"])
  git(root, ["commit", "-q", "-m", "initial"])
  return { root, base, ctx: { cwd: root, sessionId: "ses_worktree", worktree: new WorktreeManager(root, undefined, base) } }
}

test("worktree tools create, list, and remove an isolated branch", async () => {
  const { root, base, ctx } = repo()
  try {
    const created = await worktree_create.execute({ name: "feature" }, ctx)
    expect(created.ok).toBe(true)
    expect(created.output).toContain("nexus/feature")
    const directory = /created worktree (.*) on branch/.exec(created.output)?.[1] ?? ""
    expect(directory).toStartWith(base)
    expect(existsSync(join(directory, ".git"))).toBe(true)

    const listed = await worktree_list.execute({}, ctx)
    expect(listed.ok).toBe(true)
    expect(listed.output).toContain(root)
    expect(listed.output).toContain(directory)
    expect(listed.output).toContain("nexus/feature")

    const removed = await worktree_remove.execute({ directory }, ctx)
    expect(removed.ok).toBe(true)
    expect(existsSync(directory)).toBe(false)

    const after = await worktree_list.execute({}, ctx)
    expect(after.output).not.toContain(directory)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(base, { recursive: true, force: true })
  }
})

test("dirty worktrees require force", async () => {
  const { root, base, ctx } = repo()
  try {
    const created = await worktree_create.execute({ name: "dirty" }, ctx)
    expect(created.ok).toBe(true)
    const directory = /created worktree (.*) on branch/.exec(created.output)?.[1] ?? ""
    writeFileSync(join(directory, "scratch.txt"), "uncommitted\n")

    const refused = await worktree_remove.execute({ directory }, ctx)
    expect(refused.ok).toBe(false)
    expect(refused.error).toContain("git worktree remove failed")

    const forced = await worktree_remove.execute({ directory, force: true }, ctx)
    expect(forced.ok).toBe(true)
    expect(existsSync(directory)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(base, { recursive: true, force: true })
  }
})

test("worktree tools report a clear error outside a git repository", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-no-git-"))
  try {
    const ctx: ToolContext = { cwd: dir, worktree: new WorktreeManager(dir) }
    const result = await worktree_list.execute({}, ctx)
    expect(result.ok).toBe(false)
    expect(result.error).toContain("not a git repository")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("worktree tools report unavailable without a runtime", async () => {
  const result = await worktree_create.execute({}, { cwd: "/" })
  expect(result).toEqual({ ok: false, output: "", error: "git worktrees unavailable in this runtime" })
})
