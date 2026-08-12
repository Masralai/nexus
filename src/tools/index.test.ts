import { expect, test } from "bun:test"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bash, edit, glob, grep, read, write } from "./index"
import type { ToolContext } from "../engine/types"

let n = 0
function tmp(): string {
  const dir = join(tmpdir(), "nexus-tools-" + (n++).toString(36) + "-" + Math.random().toString(36).slice(2))
  mkdirSync(dir, { recursive: true })
  return dir
}

const allow: ToolContext = { cwd: "", requirePermission: async () => true }
const deny: ToolContext = { cwd: "", requirePermission: async () => false }

test("read returns file content and respects offset/limit", async () => {
  const dir = tmp()
  writeFileSync(join(dir, "a.txt"), "l1\nl2\nl3\n")
  const ctx = { ...allow, cwd: dir }
  expect((await read.execute({ path: "a.txt" }, ctx)).output).toBe("l1\nl2\nl3")
  expect((await read.execute({ path: "a.txt", offset: 1 }, ctx)).output).toBe("[lines 1-2 of 3]\nl2\nl3")
})

test("write creates a file", async () => {
  const dir = tmp()
  const r = await write.execute({ path: "b.txt", content: "hi" }, { ...allow, cwd: dir })
  expect(r.ok).toBe(true)
  expect(existsSync(join(dir, "b.txt"))).toBe(true)
})

test("write honors permission denial", async () => {
  const dir = tmp()
  const r = await write.execute({ path: "b.txt", content: "hi" }, { ...deny, cwd: dir })
  expect(r).toEqual({ ok: false, output: "", error: "permission denied" })
})

test("edit replaces first occurrence and errors when missing", async () => {
  const dir = tmp()
  writeFileSync(join(dir, "c.txt"), "foo foo")
  const ctx = { ...allow, cwd: dir }
  await edit.execute({ path: "c.txt", oldString: "foo", newString: "bar" }, ctx)
  expect((await read.execute({ path: "c.txt" }, ctx)).output).toBe("bar foo")
  const missing = await edit.execute({ path: "c.txt", oldString: "zzz", newString: "x" }, ctx)
  expect(missing).toEqual({ ok: false, output: "", error: "oldString not found" })
})

test("bash runs commands and truncates large output", async () => {
  const dir = tmp()
  const ok = await bash.execute({ command: "echo hello" }, { ...allow, cwd: dir })
  expect(ok).toEqual({ ok: true, output: "hello\n" })
  const big = await bash.execute({ command: "seq 2000", }, { ...allow, cwd: dir })
  expect(big.ok).toBe(true)
  expect(big.output.includes("[...truncated")).toBe(true)
  expect(big.output.length).toBeLessThan(9000)
})

test("bash honors permission denial", async () => {
  const r = await bash.execute({ command: "ls" }, { ...deny, cwd: tmp() })
  expect(r).toEqual({ ok: false, output: "", error: "permission denied" })
})

test("glob finds matching files", async () => {
  const dir = tmp()
  writeFileSync(join(dir, "x.ts"), "")
  writeFileSync(join(dir, "y.js"), "")
  mkdirSync(join(dir, "sub"))
  writeFileSync(join(dir, "sub", "z.ts"), "")
  const r = await glob.execute({ pattern: "**/*.ts" }, { ...allow, cwd: dir })
  expect(r.output.split("\n").sort()).toEqual(["sub/z.ts", "x.ts"])
})

test("grep finds matches with file:line", async () => {
  const dir = tmp()
  writeFileSync(join(dir, "a.txt"), "needle here\nplain")
  writeFileSync(join(dir, "b.txt"), "nothing")
  const r = await grep.execute({ pattern: "needle" }, { ...allow, cwd: dir })
  expect(r.output).toBe("a.txt:1:needle here")
})