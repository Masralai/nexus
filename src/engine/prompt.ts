import { execFile } from "node:child_process"
import type { AgentMode } from "./mode"
import { modePolicy } from "./mode"
import type { InstructionFile } from "./instructions"
import { formatInstructions } from "./instructions"
import { formatSkillsPrompt, type Skill } from "../skills"
import type { Tool } from "./types"

export interface EnvironmentInfo {
  cwd: string
  platform: string
  date: string
  model: string
  provider: string
  git?: string
}

export interface PromptInput {
  mode: AgentMode
  skills?: Skill[]
  instructions?: readonly InstructionFile[]
  tools?: readonly Pick<Tool, "name">[]
  /** Custom agent instructions from configuration. */
  agentPrompt?: string
  environment: EnvironmentInfo
}

const BASE = `You are Nexus, a capable assistant in a terminal shell.

Help with whatever the user asks: explanation, planning, writing, analysis, or repository work. Prefer a normal conversational reply when tools are not needed. Use tools when the task requires reading, searching, changing files, or running commands.

Tool use:
- You may call multiple tools in one step. Emit one call per file or task; never batch paths into a single call or encode several JSON objects in one call.
- Independent reads, searches, and sub-agent tasks should run in parallel.
- Read a file before editing it. Match existing code style and keep changes scoped.
- If a tool returns "permission denied", the user declined. Say that plainly; do not invent sandbox or OS failures.
- Do not claim a file changed or a command ran unless its tool result says so.`

const TOOL_GUIDANCE: Record<string, string> = {
  read: "Use read to inspect files; pass offsets for large files instead of reading everything.",
  edit: "Use edit for exact replacements. The old text must be unique unless replaceAll is requested.",
  write: "Use write for new files or full rewrites. Read an existing file before overwriting it.",
  bash: "Use bash for commands that need a shell. Prefer dedicated tools for file operations, and avoid destructive commands.",
  grep: "Use grep to find symbols and text. Narrow with include/path instead of searching the whole home directory.",
  glob: "Use glob to find files by pattern; prefer it over shell find.",
  apply_patch: "Use apply_patch for multi-hunk changes when the format is supported.",
  task: "Use task for scoped exploration or review in a child session. State the question and expected output.",
}

export function gitSummary(cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["status", "--porcelain=v1", "--branch"],
      { cwd, encoding: "utf8", timeout: 1500 },
      (error, stdout) => {
        if (error) {
          resolve(undefined)
          return
        }
        const out = stdout.trim()
        const lines = out.split("\n")
        const branch = lines[0]?.replace(/^##\s*/, "") ?? "unknown"
        const changed = lines.slice(1).filter(Boolean)
        const shown = changed.slice(0, 20).join("\n")
        resolve(
          `branch: ${branch}\n${shown}${changed.length > 20 ? `\n… ${changed.length - 20} more` : ""}${
            changed.length === 0 ? "\nworking tree clean" : ""
          }`,
        )
      },
    )
  })
}

export function environmentBlock(env: EnvironmentInfo): string {
  const lines = [
    `Working directory: ${env.cwd}`,
    `Platform: ${env.platform}`,
    `Date: ${env.date}`,
    `Model: ${env.model} (${env.provider})`,
  ]
  if (env.git) lines.push(`Git:\n${env.git}`)
  return lines.join("\n")
}

export function toolGuidance(toolNames: readonly string[]): string {
  const names = new Set(toolNames)
  const lines = Object.entries(TOOL_GUIDANCE)
    .filter(([name]) => names.has(name))
    .map(([, text]) => `- ${text}`)
  return lines.join("\n")
}

/**
 * Compose the provider system channel.
 *
 * This is durable policy only. Session history and the active request stay in
 * the message list so prompt caching and compaction keep working.
 */
export function renderSystemPrompt(input: PromptInput): string {
  const { guidance } = modePolicy(input.mode)
  const toolBlock = toolGuidance((input.tools ?? []).map((t) => t.name))
  const instructionText = input.instructions?.length ? formatInstructions(input.instructions) : ""
  const skillText = formatSkillsPrompt(input.skills ?? [])

  // Stable prefix first, then instructions, then the environment block (date
  // and git state vary), keeping the cacheable prefix as long as possible.
  const sections = [BASE, guidance.trim() ? guidance.trim() : `Mode: ${input.mode}`]
  if (input.agentPrompt?.trim()) sections.push(`Agent instructions:\n${input.agentPrompt.trim()}`)
  if (toolBlock) sections.push(`Tool guidance:\n${toolBlock}`)
  if (instructionText) sections.push(`Project instructions:\n${instructionText}`)
  if (skillText) sections.push(skillText)
  sections.push(`Environment:\n${environmentBlock(input.environment)}`)
  return sections.filter(Boolean).join("\n\n")
}
