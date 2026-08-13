import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface HarnessConfig {
  provider: string
  model: string
  maxSteps: number
  compactModel: string
  compactThreshold: number
}

const DEFAULTS: HarnessConfig = {
  provider: "openai-compatible",
  model: "",
  maxSteps: 50,
  compactModel: "",
  compactThreshold: 0.8,
}

function num(v: string | undefined): number | undefined {
  return v === undefined ? undefined : Number(v) || undefined
}

function readFile(file?: string): Partial<HarnessConfig> {
  const path = file ?? join(homedir(), ".harness.json")
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"))
    if (typeof raw !== "object" || raw === null) throw new Error("must be a JSON object")
    return raw
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw new Error(`~/.harness.json: ${(e as Error).message}`)
  }
}

/** Documented smaller defaults when compactModel unset. */
export function defaultCompactModel(provider: string): string {
  if (provider === "anthropic") return "claude-3-5-haiku-latest"
  if (provider === "mock") return "mock"
  return "gpt-4o-mini"
}

export function loadConfig(opts: { model?: string; file?: string } = {}): HarnessConfig {
  const raw = readFile(opts.file)
  return {
    provider: process.env.HARNESS_PROVIDER ?? raw.provider ?? DEFAULTS.provider,
    model: opts.model ?? process.env.HARNESS_MODEL ?? raw.model ?? DEFAULTS.model,
    maxSteps: num(process.env.HARNESS_MAX_STEPS) ?? raw.maxSteps ?? DEFAULTS.maxSteps,
    compactModel:
      process.env.HARNESS_COMPACT_MODEL ?? raw.compactModel ?? DEFAULTS.compactModel,
    compactThreshold:
      num(process.env.HARNESS_COMPACT_THRESHOLD) ?? raw.compactThreshold ?? DEFAULTS.compactThreshold,
  }
}
