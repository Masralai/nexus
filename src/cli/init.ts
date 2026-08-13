import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import * as readline from "node:readline/promises"

export function defaultConfigPath(): string {
  return join(homedir(), ".harness.json")
}

export function writeHarnessConfig(path: string, cfg: { provider: string; model: string }): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 })
}

export function initConfig(opts: {
  path: string
  provider: string
  model: string
  force?: boolean
}): void {
  if (existsSync(opts.path) && !opts.force) {
    throw new Error(`${opts.path} exists; re-run with --force to overwrite`)
  }
  writeHarnessConfig(opts.path, { provider: opts.provider, model: opts.model })
}

export async function runInit(opts: { force?: boolean; path?: string } = {}): Promise<void> {
  const path = opts.path ?? defaultConfigPath()
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const provider =
      (await rl.question("provider [openai-compatible|anthropic] (openai-compatible): ")).trim() ||
      "openai-compatible"
    const model = (await rl.question("model: ")).trim()
    if (!model) throw new Error("model is required")
    initConfig({ path, provider, model, force: opts.force })
    console.log(`wrote ${path}`)
    console.log("Set API keys via env (not stored in config):")
    console.log("  ANTHROPIC_API_KEY  or  OPENAI_API_KEY")
    console.log("  optional: OPENAI_BASE_URL for openai-compatible endpoints")
  } finally {
    rl.close()
  }
}
