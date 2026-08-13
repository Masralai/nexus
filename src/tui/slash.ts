export interface SlashCommand {
  id: string
  /** Short help shown in the / menu */
  hint: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "key", hint: "connect provider + API key" },
  { id: "model", hint: "set model" },
  { id: "plan", hint: "read-only plan mode" },
  { id: "build", hint: "full tools build mode" },
  { id: "resume", hint: "continue a past session" },
  { id: "new", hint: "start a fresh session" },
  { id: "help", hint: "list commands" },
  { id: "quit", hint: "exit" },
  { id: "exit", hint: "exit" },
]

export function parseSlash(raw: string): string {
  return raw.slice(1).trim().split(/\s+/)[0]?.toLowerCase() ?? ""
}

/** Filter commands while the user types `/…` (prefix match on id). */
export function filterSlashCommands(input: string): SlashCommand[] {
  if (!input.startsWith("/")) return []
  const q = input.slice(1).trim().toLowerCase()
  if (!q) return SLASH_COMMANDS.filter((c) => c.id !== "exit") // hide duplicate exit in empty menu
  return SLASH_COMMANDS.filter((c) => c.id.startsWith(q))
}

export const HELP = SLASH_COMMANDS.filter((c) => c.id !== "exit")
  .map((c) => `/${c.id.padEnd(7)} ${c.hint}`)
  .join("\n")
