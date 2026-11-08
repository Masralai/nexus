import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { git_diff, git_log, git_status } from "./git"

test("git tools report status, diff, and log", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-git-"))
  const run = (args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      stdio: "ignore",
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
    })
  try {
    run(["init"])
    writeFileSync(join(dir, "a.txt"), "one\n")
    run(["add", "a.txt"])
    run(["commit", "-m", "first"])
    expect((await git_log.execute({ limit: 1 }, { cwd: dir })).output).toContain("first")

    writeFileSync(join(dir, "a.txt"), "two\n")
    expect((await git_status.execute({}, { cwd: dir })).output).toContain("a.txt")
    expect((await git_diff.execute({}, { cwd: dir })).output).toContain("-one")
    expect((await git_diff.execute({}, { cwd: dir })).output).toContain("+two")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
