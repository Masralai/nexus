import { existsSync } from "node:fs"
import { basename, isAbsolute, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { PluginConfig } from "../cli/config"
import { PluginRegistry, type PluginHooks } from "./hooks"

export interface PluginLoadError {
  path: string
  message: string
}

export interface LoadedPlugins {
  registry: PluginRegistry
  errors: PluginLoadError[]
}

export interface LoadPluginsOptions {
  cwd: string
  /** Load into an existing registry instead of a fresh one. */
  registry?: PluginRegistry
}

type Entry = string | PluginConfig

interface PluginFactoryInput {
  cwd: string
  options?: Record<string, unknown>
}

type PluginExport = PluginHooks | ((input: PluginFactoryInput) => PluginHooks | Promise<PluginHooks>)

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Resolve a plugin path the way a local import would, without a bundler. */
function resolveModule(path: string, cwd: string): string {
  const base = isAbsolute(path) ? path : resolve(cwd, path)
  if (existsSync(base)) return base
  for (const suffix of [".ts", ".tsx", ".js", ".mjs", ".cjs"]) {
    if (existsSync(`${base}${suffix}`)) return `${base}${suffix}`
  }
  for (const index of ["index.ts", "index.tsx", "index.js", "index.mjs"]) {
    const candidate = resolve(base, index)
    if (existsSync(candidate)) return candidate
  }
  return base
}

function isHooks(value: unknown): value is PluginHooks {
  return Boolean(value && typeof value === "object" && typeof (value as PluginHooks).name === "string")
}

/**
 * Load local plugin modules from configuration. One broken plugin never
 * prevents the rest from loading: failures are returned for diagnostics and
 * the Turn continues without that extension.
 */
export async function loadPlugins(entries: readonly Entry[], opts: LoadPluginsOptions): Promise<LoadedPlugins> {
  const registry = opts.registry ?? new PluginRegistry()
  const errors: PluginLoadError[] = []

  for (const entry of entries) {
    const path = typeof entry === "string" ? entry : entry.path
    const options = typeof entry === "string" ? undefined : entry.options
    const modulePath = resolveModule(path, opts.cwd)
    try {
      const imported = (await import(pathToFileURL(modulePath).href)) as {
        default?: PluginExport
        plugin?: PluginExport
      }
      const exported = imported.default ?? imported.plugin
      if (!exported) throw new Error("plugin module must export a default plugin or a `plugin` export")
      const hooks = typeof exported === "function" ? await exported({ cwd: opts.cwd, options }) : exported
      if (!isHooks(hooks)) throw new Error("plugin must expose a name")
      registry.use({ ...hooks, name: hooks.name || basename(modulePath) })
    } catch (e) {
      errors.push({ path: modulePath, message: errorText(e) })
    }
  }

  return { registry, errors }
}
