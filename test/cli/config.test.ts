import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultCompactModel, findProjectConfig, loadConfig } from "../../src/cli/config"

function cfgFile(cfg: object): string {
  const dir = mkdtempSync(join(tmpdir(), "nexus-"))
  const path = join(dir, "cfg.json")
  writeFileSync(path, JSON.stringify(cfg))
  return path
}

test("precedence: cli model > env > file > defaults", () => {
  const file = cfgFile({
    provider: "file",
    preset: "custom",
    model: "file-model",
    maxSteps: 10,
    compactModel: "file-c",
    compactThreshold: 0.5,
  })
  process.env.NEXUS_PROVIDER = "env"
  process.env.NEXUS_MODEL = "env-model"
  process.env.NEXUS_MAX_STEPS = "20"
  process.env.NEXUS_COMPACT_MODEL = "env-c"
  process.env.NEXUS_COMPACT_THRESHOLD = "0.9"
  try {
    expect(loadConfig({ file })).toMatchObject({
      provider: "env",
      model: "env-model",
      maxSteps: 20,
      compactModel: "env-c",
      compactThreshold: 0.9,
    })
    expect(loadConfig({ file, model: "cli" }).model).toBe("cli")
  } finally {
    delete process.env.NEXUS_PROVIDER
    delete process.env.NEXUS_MODEL
    delete process.env.NEXUS_MAX_STEPS
    delete process.env.NEXUS_COMPACT_MODEL
    delete process.env.NEXUS_COMPACT_THRESHOLD
  }
})

test("known presets own provider and endpoint regardless of stale config", () => {
  const prevPreset = process.env.NEXUS_PRESET
  const prevProvider = process.env.NEXUS_PROVIDER
  const prevBase = process.env.NEXUS_BASE_URL
  try {
    process.env.NEXUS_PRESET = "deepseek"
    process.env.NEXUS_PROVIDER = "anthropic"
    delete process.env.NEXUS_BASE_URL
    const file = cfgFile({
      preset: "openai",
      provider: "anthropic",
      baseUrl: "https://api.openai.com/v1",
    })
    expect(loadConfig({ file })).toMatchObject({
      preset: "deepseek",
      provider: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
    })
  } finally {
    if (prevPreset === undefined) delete process.env.NEXUS_PRESET
    else process.env.NEXUS_PRESET = prevPreset
    if (prevProvider === undefined) delete process.env.NEXUS_PROVIDER
    else process.env.NEXUS_PROVIDER = prevProvider
    if (prevBase === undefined) delete process.env.NEXUS_BASE_URL
    else process.env.NEXUS_BASE_URL = prevBase
  }
})

test("configured instruction paths resolve from the declaring config file", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-instructions-"))
  const file = join(dir, ".nexus.json")
  writeFileSync(file, JSON.stringify({ instructions: ["AGENTS.md", "https://example.test/rules.md"] }))
  expect(loadConfig({ file }).instructions).toEqual([
    join(dir, "AGENTS.md"),
    "https://example.test/rules.md",
  ])
})

test("missing file falls back to defaults", () => {
  expect(loadConfig({ file: "/nonexistent/nexus-cfg.json" })).toMatchObject({
    provider: "openai-compatible",
    preset: "openai",
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

test("defaultCompactModel follows the active preset", () => {
  expect(defaultCompactModel("anthropic")).toBe("claude-3-5-haiku-latest")
  expect(defaultCompactModel("openai")).toBe("gpt-4o-mini")
  expect(defaultCompactModel("deepseek")).toBe("deepseek-chat")
  expect(defaultCompactModel("groq")).toBe("llama-3.1-8b-instant")
  expect(defaultCompactModel("custom", "openai-compatible", "my-model")).toBe("my-model")
  expect(defaultCompactModel("anthropic", "mock")).toBe("mock")
})

test("invalid config values are rejected with the source path", () => {
  expect(() => loadConfig({ file: cfgFile({ maxSteps: 0 }) })).toThrow(/maxSteps/)
  expect(() => loadConfig({ file: cfgFile({ compactThreshold: 2 }) })).toThrow(/compactThreshold/)
  expect(() => loadConfig({ file: cfgFile({ instructions: "AGENTS.md" }) })).toThrow(/instructions/)
})

test("project config is discovered from the nearest ancestor", () => {
  const root = mkdtempSync(join(tmpdir(), "nexus-project-"))
  const nested = join(root, "a", "b")
  mkdirSync(nested, { recursive: true })
  writeFileSync(join(root, ".nexus.json"), JSON.stringify({ model: "root-model" }))
  writeFileSync(join(root, "a", ".nexus.json"), JSON.stringify({ model: "a-model" }))
  expect(findProjectConfig(nested)).toBe(join(root, "a", ".nexus.json"))
  expect(findProjectConfig(root)).toBe(join(root, ".nexus.json"))
})
