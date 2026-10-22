import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { getCredential } from "./credentials"
import { getPreset, type Preset } from "../providers/presets"
import type { PermissionRules } from "../engine/permission"

export interface NexusConfig {
  provider: string
  preset: string
  model: string
  maxSteps: number
  compactModel: string
  compactThreshold: number
  baseUrl?: string
  permission?: PermissionRules
  /** Extra instruction files or URLs, resolved relative to the project root. */
  instructions?: string[]
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

/** Nearest project config, walking up from cwd. The global config is never a project config. */
export function findProjectConfig(cwd = process.cwd()): string | undefined {
  const global = resolve(defaultConfigPath())
  let dir = resolve(cwd)
  while (true) {
    const candidate = join(dir, ".nexus.json")
    if (resolve(candidate) !== global && existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function readFile(file?: string): Partial<NexusConfig> {
  const path = file ?? defaultConfigPath()
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"))
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("must be a JSON object")
    return raw as Partial<NexusConfig>
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw new Error(`${path}: ${(e as Error).message}`)
  }
}

export function validateConfig(cfg: NexusConfig, source = "config"): NexusConfig {
  const fail = (message: string): never => {
    throw new Error(`${source}: ${message}`)
  }
  if (typeof cfg.provider !== "string" || cfg.provider.length === 0) fail("provider must be a non-empty string")
  if (typeof cfg.preset !== "string" || cfg.preset.length === 0) fail("preset must be a non-empty string")
  if (typeof cfg.model !== "string") fail("model must be a string")
  if (!Number.isFinite(cfg.maxSteps) || cfg.maxSteps < 1) fail("maxSteps must be a positive number")
  if (!Number.isFinite(cfg.compactThreshold) || cfg.compactThreshold < 0 || cfg.compactThreshold > 1) {
    fail("compactThreshold must be between 0 and 1")
  }
  if (cfg.baseUrl !== undefined && typeof cfg.baseUrl !== "string") fail("baseUrl must be a string")
  if (cfg.instructions !== undefined) {
    if (!Array.isArray(cfg.instructions) || cfg.instructions.some((i) => typeof i !== "string")) {
      fail("instructions must be an array of strings")
    }
  }
  return cfg
}

/** Resolve relative instruction paths against the config file that declared them. */
function normalizeInstructions(partial: Partial<NexusConfig>, file: string): Partial<NexusConfig> {
  if (!partial.instructions) return partial
  const dir = dirname(file)
  return {
    ...partial,
    instructions: partial.instructions.map((item) =>
      /^https?:\/\//.test(item) || isAbsolute(item) ? item : resolve(dir, item),
    ),
  }
}

/** Merge global config, project config, then explicit file. Later scopes win. */
export function readConfigScopes(opts: { file?: string; cwd?: string } = {}): Partial<NexusConfig> {
  if (opts.file) return normalizeInstructions(readFile(opts.file), opts.file)
  const globalPath = defaultConfigPath()
  const global = normalizeInstructions(readFile(globalPath), globalPath)
  const projectPath = findProjectConfig(opts.cwd)
  const project = projectPath ? normalizeInstructions(readFile(projectPath), projectPath) : {}
  return { ...global, ...project }
}

export function saveConfig(partial: Partial<NexusConfig>, path = defaultConfigPath()): void {
  const raw = readFile(path) as Record<string, unknown>
  const next: Record<string, unknown> = { ...raw }
  for (const [key, value] of Object.entries(partial)) {
    if (value !== undefined) next[key] = value
    else if (key === "baseUrl") delete next.baseUrl
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 })
}

/** Prefer the smallest suggested model for the active preset, never another provider's model. */
export function defaultCompactModel(preset: string, provider?: string, model?: string): string {
  if (provider === "mock" || preset === "mock") return "mock"
  const known = getPreset(preset)
  if (known?.suggestedModels.length) {
    const suggested = known.suggestedModels
    return suggested.find((id) => /mini|haiku|flash|instant|8b|chat/.test(id)) ?? suggested[suggested.length - 1]
  }
  if (model) return model
  if (provider === "anthropic") return "claude-3-5-haiku-latest"
  return "gpt-4o-mini"
}

export function loadConfig(opts: { model?: string; file?: string; cwd?: string } = {}): NexusConfig {
  const raw = readConfigScopes(opts)
  const preset = process.env.NEXUS_PRESET ?? raw.preset ?? DEFAULTS.preset
  const fromPreset = getPreset(preset)
  // A known preset owns both its adapter and endpoint. Only custom presets may
  // take provider/baseUrl from configuration, so one provider's key can never
  // be sent to another provider's endpoint.
  const cfg: NexusConfig = {
    provider: fromPreset?.adapter ?? process.env.NEXUS_PROVIDER ?? raw.provider ?? DEFAULTS.provider,
    preset,
    model: opts.model ?? process.env.NEXUS_MODEL ?? raw.model ?? DEFAULTS.model,
    maxSteps: num(process.env.NEXUS_MAX_STEPS) ?? raw.maxSteps ?? DEFAULTS.maxSteps,
    compactModel: process.env.NEXUS_COMPACT_MODEL ?? raw.compactModel ?? DEFAULTS.compactModel,
    compactThreshold:
      num(process.env.NEXUS_COMPACT_THRESHOLD) ?? raw.compactThreshold ?? DEFAULTS.compactThreshold,
    baseUrl: process.env.NEXUS_BASE_URL ?? (fromPreset ? fromPreset.baseUrl : raw.baseUrl),
    permission: raw.permission,
    instructions: raw.instructions,
  }
  return validateConfig(cfg, opts.file ?? "config")
}

/**
 * Env wins, then the credentials file entry for the active preset.
 * Never borrow another provider's key.
 */
export function resolveApiKey(cfg: NexusConfig, credPath?: string): string | undefined {
  const preset = getPreset(cfg.preset)
  const envKeys = preset?.envKeys ?? (cfg.provider === "anthropic" ? ["ANTHROPIC_API_KEY"] : [])
  for (const name of envKeys) {
    const v = process.env[name]
    if (v) return v
  }
  const id = cfg.preset || (cfg.provider === "anthropic" ? "anthropic" : "openai")
  return getCredential(id, credPath)?.apiKey
}

export function presetRequiresKey(cfg: NexusConfig): boolean {
  if (cfg.provider === "mock" || cfg.preset === "mock") return false
  return getPreset(cfg.preset)?.requiresKey ?? true
}

export function hasResolvableKey(cfg: NexusConfig = loadConfig()): boolean {
  if (!presetRequiresKey(cfg)) return true
  return Boolean(resolveApiKey(cfg))
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
