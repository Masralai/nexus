import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadConfig } from "../../src/cli/config"

function cfgFile(cfg: object): string {
  const dir = mkdtempSync(join(tmpdir(), "nexus-"))
  const path = join(dir, "cfg.json")
  writeFileSync(path, JSON.stringify(cfg))
  return path
}

test("precedence: cli model > env > file > defaults", () => {
  const file = cfgFile({ provider: "file", model: "file-model", maxSteps: 10 })
  process.env.HARNESS_PROVIDER = "env"
  process.env.HARNESS_MODEL = "env-model"
  process.env.HARNESS_MAX_STEPS = "20"
  try {
    expect(loadConfig({ file })).toEqual({ provider: "env", model: "env-model", maxSteps: 20 })
    expect(loadConfig({ file, model: "cli" })).toEqual({ provider: "env", model: "cli", maxSteps: 20 })
  } finally {
    delete process.env.HARNESS_PROVIDER
    delete process.env.HARNESS_MODEL
    delete process.env.HARNESS_MAX_STEPS
  }
})

test("missing file falls back to defaults", () => {
  expect(loadConfig({ file: "/nonexistent/nexus-cfg.json" })).toEqual({
    provider: "openai-compatible",
    model: "",
    maxSteps: 50,
  })
})

test("invalid JSON config errors", () => {
  const file = cfgFile({ bad: "json" })
  writeFileSync(file, "not json")
  expect(() => loadConfig({ file })).toThrow()
})