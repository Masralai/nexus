import { expect, test } from "bun:test"
import { renderSystemPrompt, toolGuidance, type EnvironmentInfo } from "./prompt"
import type { InstructionFile } from "./instructions"
import type { Skill } from "../skills"

const env: EnvironmentInfo = {
  cwd: "/tmp/project",
  platform: "linux x64",
  date: "2026-10-22",
  model: "gpt-4o",
  provider: "openai-compatible",
}

const instructions: InstructionFile[] = [
  { path: "/tmp/project/AGENTS.md", content: "Use bun, not npm." },
]

const skill: Skill = {
  id: "tdd",
  name: "tdd",
  description: "test first",
  body: "Write the failing test first.",
  path: "/tmp/skills/tdd",
}

test("system prompt snapshot", () => {
  const out = renderSystemPrompt({
    mode: "build",
    environment: env,
    tools: [{ name: "read" }, { name: "edit" }, { name: "bash" }],
    instructions,
    skills: [skill],
  })
  expect(out).toMatchSnapshot()
})

test("system prompt contains environment and project instructions", () => {
  const out = renderSystemPrompt({ mode: "plan", environment: env, instructions })
  expect(out).toContain("Working directory: /tmp/project")
  expect(out).toContain("Date: 2026-10-22")
  expect(out).toContain("Model: gpt-4o (openai-compatible)")
  expect(out).toContain("Mode: plan")
  expect(out).toContain("Use bun, not npm.")
  expect(out).not.toContain("[working-memory]")
})

test("tool guidance only mentions advertised tools", () => {
  expect(toolGuidance(["read", "bash"])).toContain("Use read")
  expect(toolGuidance(["read", "bash"])).toContain("Use bash")
  expect(toolGuidance(["read"])).not.toContain("Use edit")
})

test("skill bodies are included with provenance", () => {
  const out = renderSystemPrompt({ mode: "build", environment: env, skills: [skill] })
  expect(out).toContain("## Skill: tdd")
  expect(out).toContain("Write the failing test first.")
})
