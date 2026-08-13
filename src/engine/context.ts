import type { Message } from "./types"

export function truncate(text: string, max = 4000): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[...truncated ${text.length - max} chars]`
}

export function approxTokens(m: Message): number {
  const text = m.role === "tool" ? m.result.output + (m.result.error ?? "") : (m.content ?? "")
  return Math.ceil(text.length / 4)
}

const GUIDANCE = `You are Nexus, a coding assistant in a chat shell.
Prefer a normal conversational reply in plain text.
Do not use tools for greetings, chitchat, or questions you can answer without the repo.
Use tools only when the user wants file, shell, or repository work.
If a tool returns "permission denied", the user declined that tool — say that; do not invent OS/sandbox permission failures.`

export function workingMemory(messages: Message[], mode: "plan" | "build" = "build"): string {
  // ponytail: latest user message is the active task (not the first forever)
  const users = messages.filter((m) => m.role === "user")
  const task = users.at(-1)?.content ?? ""
  const recent = messages
    .slice(-4)
    .map((m) => (m.role === "tool" ? `[${m.name}] ${m.result.output.slice(0, 120)}` : (m.content ?? "").slice(0, 120)))
    .join("\n")
  // ponytail: plan = one extra line; build keeps default GUIDANCE only
  const modeLine =
    mode === "plan"
      ? "\nMode: plan — explore and propose a plan; do not implement or mutate files."
      : ""
  return `[working-memory]
${GUIDANCE}${modeLine}

task: ${task.slice(0, 300)}
recent:
${recent}`
}
