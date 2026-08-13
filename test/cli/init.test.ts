import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initConfig, writeHarnessConfig } from "../../src/cli/init"

test("writeHarnessConfig writes provider/model with 0600", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-init-"))
  const path = join(dir, ".harness.json")
  writeHarnessConfig(path, { provider: "anthropic", model: "claude" })
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ provider: "anthropic", model: "claude" })
  expect(statSync(path).mode & 0o777).toBe(0o600)
})

test("initConfig refuses overwrite without force", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-init-"))
  const path = join(dir, ".harness.json")
  writeFileSync(path, "{}")
  expect(() => initConfig({ path, provider: "x", model: "y" })).toThrow(/--force/)
  initConfig({ path, provider: "openai-compatible", model: "gpt", force: true })
  expect(JSON.parse(readFileSync(path, "utf8")).model).toBe("gpt")
})

test("writeHarnessConfig creates parent dirs", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-init-"))
  const path = join(dir, "nested", "cfg.json")
  writeHarnessConfig(path, { provider: "openai-compatible", model: "m" })
  expect(readFileSync(path, "utf8")).toContain("openai-compatible")
})
