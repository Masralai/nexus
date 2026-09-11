import { expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendHistory, loadHistory, writeHistory, defaultHistoryPath, HISTORY_LIMIT } from "./history"

let dir: string
let file: string
let prevEnv: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-history-"))
  file = join(dir, "history")
  prevEnv = process.env.NEXUS_HISTORY_PATH
  process.env.NEXUS_HISTORY_PATH = file
})

afterEach(() => {
  if (prevEnv === undefined) delete process.env.NEXUS_HISTORY_PATH
  else process.env.NEXUS_HISTORY_PATH = prevEnv
  rmSync(dir, { recursive: true, force: true })
})

test("defaultHistoryPath respects NEXUS_HISTORY_PATH", () => {
  expect(defaultHistoryPath()).toBe(file)
})

test("loadHistory returns [] when missing", () => {
  expect(loadHistory(file)).toEqual([])
})

test("write + load round trip", () => {
  writeHistory(["first", "second"], file)
  expect(loadHistory(file)).toEqual(["first", "second"])
  // file is JSONL with 600 mode
  const raw = readFileSync(file, "utf8")
  expect(raw).toBe(`"first"\n"second"\n`)
})

test("appendHistory dedups consecutive", () => {
  appendHistory("hello", file)
  appendHistory("hello", file)
  expect(loadHistory(file)).toEqual(["hello"])
})

test("appendHistory allows non-consecutive duplicate", () => {
  appendHistory("a", file)
  appendHistory("b", file)
  appendHistory("a", file)
  expect(loadHistory(file)).toEqual(["a", "b", "a"])
})

test("appendHistory trims and ignores empty", () => {
  appendHistory("  ", file)
  expect(loadHistory(file)).toEqual([])
  appendHistory("  hi  ", file)
  expect(loadHistory(file)).toEqual(["hi"])
})

test("appendHistory caps at 100", () => {
  for (let i = 0; i < 105; i++) appendHistory(`p${i}`, file)
  const h = loadHistory(file)
  expect(h.length).toBe(100)
  expect(h[0]).toBe("p5")
  expect(h[99]).toBe("p104")
  expect(HISTORY_LIMIT).toBe(100)
})

test("writeHistory caps", () => {
  const big = Array.from({ length: 150 }, (_, i) => `x${i}`)
  writeHistory(big, file)
  expect(loadHistory(file).length).toBe(100)
  expect(loadHistory(file)[0]).toBe("x50")
})

test("handles lines with quotes and newlines via JSON", () => {
  const s = `a "quoted" \n line`
  appendHistory(s, file)
  expect(loadHistory(file)).toEqual([s])
})

test("tolerates legacy plain text line without JSON", () => {
  writeFileSync(file, "plain line without json\n\"json line\"\n")
  expect(loadHistory(file)).toEqual(["plain line without json", "json line"])
})

test("tolerates corrupt file returns empty or skips bad? Current returns [] on ENOENT only, else filtered; bad JSON falls back to raw", () => {
  writeFileSync(file, "not-json-but-fallback\n")
  expect(loadHistory(file)).toEqual(["not-json-but-fallback"])
})

test("loadHistory limit slice", () => {
  writeHistory(["a", "b", "c", "d"], file)
  expect(loadHistory(file, 2)).toEqual(["c", "d"])
})
