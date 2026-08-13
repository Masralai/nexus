import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getCredential, loadCredentials, saveCredentials, setCredential } from "../../src/cli/credentials"
import { loadConfig, resolveApiKey } from "../../src/cli/config"
import { PRESETS, getPreset } from "../../src/providers/presets"

test("credentials round-trip with 0600", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-creds-"))
  const path = join(dir, "credentials.json")
  setCredential("openrouter", { apiKey: "sk-test", baseUrl: "https://openrouter.ai/api/v1" }, path)
  expect(getCredential("openrouter", path)).toEqual({
    apiKey: "sk-test",
    baseUrl: "https://openrouter.ai/api/v1",
  })
  expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(loadCredentials(path).openrouter.apiKey).toBe("sk-test")
})

test("saveCredentials overwrites entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-creds-"))
  const path = join(dir, "credentials.json")
  saveCredentials({ a: { apiKey: "1" } }, path)
  saveCredentials({ a: { apiKey: "2" }, b: { apiKey: "3" } }, path)
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ a: { apiKey: "2" }, b: { apiKey: "3" } })
})

test("resolveApiKey: env wins over credentials file", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-creds-"))
  const path = join(dir, "credentials.json")
  setCredential("openai", { apiKey: "from-file" }, path)
  const prev = process.env.OPENAI_API_KEY
  try {
    process.env.OPENAI_API_KEY = "from-env"
    // point home-less: inject via getCredential path — resolveApiKey uses default path
    // so we only assert env branch here
    const cfg = loadConfig({ file: join(dir, "missing.json") })
    cfg.preset = "openai"
    cfg.provider = "openai-compatible"
    expect(resolveApiKey(cfg)).toBe("from-env")
    delete process.env.OPENAI_API_KEY
    // without env and without default credentials path entry, undefined
    expect(resolveApiKey(cfg)).toBeUndefined()
  } finally {
    if (prev === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = prev
  }
})

test("presets cover curated providers", () => {
  expect(PRESETS.map((p) => p.id)).toEqual([
    "anthropic",
    "openai",
    "gemini",
    "openrouter",
    "groq",
    "deepseek",
    "ollama",
  ])
  expect(getPreset("anthropic")?.adapter).toBe("anthropic")
  expect(getPreset("openrouter")?.baseUrl).toContain("openrouter")
  expect(getPreset("gemini")?.baseUrl).toContain("generativelanguage.googleapis.com")
  expect(getPreset("gemini")?.envKeys).toContain("GEMINI_API_KEY")
})

test("resolveApiKey: GEMINI_API_KEY for gemini preset", () => {
  const prev = process.env.GEMINI_API_KEY
  const prevOpen = process.env.OPENAI_API_KEY
  try {
    delete process.env.OPENAI_API_KEY
    process.env.GEMINI_API_KEY = "gem-test"
    const cfg = loadConfig({ file: "/nonexistent/nexus-cfg.json" })
    cfg.preset = "gemini"
    cfg.provider = "openai-compatible"
    expect(resolveApiKey(cfg)).toBe("gem-test")
  } finally {
    if (prev === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = prev
    if (prevOpen === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = prevOpen
  }
})
