import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultCompactModel, loadConfig } from "../../src/cli/config"

function cfgFile(cfg: object): string {
  const dir = mkdtempSync(join(tmpdir(), "nexus-"))
  const path = join(dir, "cfg.json")
  writeFileSync(path, JSON.stringify(cfg))
  return path
}

test("precedence: cli model > env > file > defaults", () => {
  const file = cfgFile({ provider: "file", model: "file-model", maxSteps: 10, compactModel: "file-c", compactThreshold: 0.5 })
  process.env.HARNESS_PROVIDER = "env"
  process.env.HARNESS_MODEL = "env-model"
  process.env.HARNESS_MAX_STEPS = "20"
  process.env.HARNESS_COMPACT_MODEL = "env-c"
  process.env.HARNESS_COMPACT_THRESHOLD = "0.9"
  try {
    expect(loadConfig({ file })).toEqual({
      provider: "env",
      model: "env-model",
      maxSteps: 20,
      compactModel: "env-c",
      compactThreshold: 0.9,
    })
    expect(loadConfig({ file, model: "cli" })).toEqual({
      provider: "env",
      model: "cli",
      maxSteps: 20,
      compactModel: "env-c",
      compactThreshold: 0.9,
    })
  } finally {
    delete process.env.HARNESS_PROVIDER
    delete process.env.HARNESS_MODEL
    delete process.env.HARNESS_MAX_STEPS
    delete process.env.HARNESS_COMPACT_MODEL
    delete process.env.HARNESS_COMPACT_THRESHOLD
  }
})

test("missing file falls back to defaults", () => {
  expect(loadConfig({ file: "/nonexistent/nexus-cfg.json" })).toEqual({
    provider: "openai-compatible",
    model: "",
    maxSteps: 50,
    compactModel: "",
    compactThreshold: 0.8,
  })
})

test("invalid JSON config errors", () => {
  const file = cfgFile({ bad: "json" })
  writeFileSync(file, "not json")
  expect(() => loadConfig({ file })).toThrow()
})

test("defaultCompactModel per provider family", () => {
  expect(defaultCompactModel("anthropic")).toBe("claude-3-5-haiku-latest")
  expect(defaultCompactModel("openai-compatible")).toBe("gpt-4o-mini")
  expect(defaultCompactModel("mock")).toBe("mock")
})
