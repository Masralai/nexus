import type { AgentConfig, CommandConfig, NexusConfig } from "./config"

export interface ResolvedCommand {
  name: string
  description?: string
  template: string
  agent?: string
  model?: string
}

export interface ResolvedAgent {
  id: string
  config: AgentConfig
}

function normalize(name: string, command: CommandConfig | string): ResolvedCommand {
  if (typeof command === "string") return { name, template: command }
  return {
    name,
    ...(command.description ? { description: command.description } : {}),
    template: command.template,
    ...(command.agent ? { agent: command.agent } : {}),
    ...(command.model ? { model: command.model } : {}),
  }
}

/** Custom slash commands from configuration, sorted for a stable menu. */
export function configuredCommands(cfg: NexusConfig): ResolvedCommand[] {
  return Object.entries(cfg.commands ?? {})
    .map(([name, command]) => normalize(name, command))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function findCommand(cfg: NexusConfig, name: string): ResolvedCommand | undefined {
  const key = name.trim().toLowerCase()
  return configuredCommands(cfg).find((command) => command.name.toLowerCase() === key)
}

export function findAgent(cfg: NexusConfig, name: string): ResolvedAgent | undefined {
  const key = name.trim().toLowerCase()
  const entry = Object.entries(cfg.agents ?? {}).find(([id]) => id.toLowerCase() === key)
  return entry ? { id: entry[0], config: entry[1] } : undefined
}

/**
 * Expand a command template. `$ARGUMENTS` (or `{args}`) receives the whole
 * argument string and `$1`, `$2`, … receive positional arguments.
 */
export function expandCommand(template: string, args = ""): string {
  const trimmed = args.trim()
  const positional = trimmed ? trimmed.split(/\s+/) : []
  return template
    .replaceAll("$ARGUMENTS", trimmed)
    .replaceAll("{args}", trimmed)
    .replace(/\$(\d+)/g, (_, index: string) => positional[Number(index) - 1] ?? "")
    .trim()
}
