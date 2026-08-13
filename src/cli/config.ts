import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { getCredential } from "./credentials"
import { getPreset, type Preset } from "../providers/presets"

export interface NexusConfig {
  provider: string
  preset: string
  model: string
  maxSteps: number
  compactModel: string
  compactThreshold: number
  baseUrl?: string
}

const DEFAULTS: NexusConfig = {
  provider: "openai-compatible",
  preset: "openai",
  model: "",
  maxSteps: 50,
  compactModel: "",
  compactThreshold: 0.8,
}

function num(v: string | undefined): number | undefined {
  return v === undefined ? undefined : Number(v) || undefined
}

export function defaultConfigPath(): string {
  return join(homedir(), ".nexus.json")
}

function readFile(file?: string): Partial<NexusConfig> {
  const path = file ?? defaultConfigPath()
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"))
    if (typeof raw !== "object" || raw === null) throw new Error("must be a JSON object")
    return raw
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw new Error(`${path}: ${(e as Error).message}`)
  }
}

export function saveConfig(partial: Partial<NexusConfig>, path = defaultConfigPath()): void {
  const raw = readFile(path)
  const next: NexusConfig = {
    provider: partial.provider ?? raw.provider ?? DEFAULTS.provider,
    preset: partial.preset ?? raw.preset ?? DEFAULTS.preset,
    model: partial.model ?? raw.model ?? DEFAULTS.model,
    maxSteps: partial.maxSteps ?? raw.maxSteps ?? DEFAULTS.maxSteps,
    compactModel: partial.compactModel ?? raw.compactModel ?? DEFAULTS.compactModel,
    compactThreshold: partial.compactThreshold ?? raw.compactThreshold ?? DEFAULTS.compactThreshold,
  }
  if ("baseUrl" in partial) next.baseUrl = partial.baseUrl
  else if (raw.baseUrl !== undefined) next.baseUrl = raw.baseUrl
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 })
}

/** Documented smaller defaults when compactModel unset. */
export function defaultCompactModel(provider: string): string {
  if (provider === "anthropic") return "claude-3-5-haiku-latest"
  if (provider === "mock") return "mock"
  return "gpt-4o-mini"
}

export function loadConfig(opts: { model?: string; file?: string } = {}): NexusConfig {
  const raw = readFile(opts.file)
  const preset = process.env.NEXUS_PRESET ?? raw.preset ?? DEFAULTS.preset
  const fromPreset = getPreset(preset)
  return {
    provider: process.env.NEXUS_PROVIDER ?? raw.provider ?? fromPreset?.adapter ?? DEFAULTS.provider,
    preset,
    model: opts.model ?? process.env.NEXUS_MODEL ?? raw.model ?? DEFAULTS.model,
    maxSteps: num(process.env.NEXUS_MAX_STEPS) ?? raw.maxSteps ?? DEFAULTS.maxSteps,
    compactModel: process.env.NEXUS_COMPACT_MODEL ?? raw.compactModel ?? DEFAULTS.compactModel,
    compactThreshold:
      num(process.env.NEXUS_COMPACT_THRESHOLD) ?? raw.compactThreshold ?? DEFAULTS.compactThreshold,
    baseUrl: process.env.OPENAI_BASE_URL ?? raw.baseUrl ?? fromPreset?.baseUrl,
  }
}

/** Env wins; then credentials file for active preset. */
export function resolveApiKey(cfg: NexusConfig): string | undefined {
  const preset = getPreset(cfg.preset)
  const envKeys =
    preset?.envKeys ??
    (cfg.provider === "anthropic" ? ["ANTHROPIC_API_KEY"] : ["OPENAI_API_KEY"])
  for (const name of envKeys) {
    const v = process.env[name]
    if (v) return v
  }
  const id = cfg.preset || (cfg.provider === "anthropic" ? "anthropic" : "openai")
  return getCredential(id)?.apiKey
}

export function hasResolvableKey(cfg: NexusConfig = loadConfig()): boolean {
  return Boolean(resolveApiKey(cfg)) || cfg.provider === "mock"
}

export function applyPresetToConfig(preset: Preset, model?: string): void {
  const current = loadConfig()
  saveConfig({
    provider: preset.adapter,
    preset: preset.id,
    baseUrl: preset.baseUrl,
    model: model ?? (current.model || preset.suggestedModels[0] || ""),
  })
}
