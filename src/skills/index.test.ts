import { expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discoverSkills, findSkill, filterSkills, loadSkill, parseSkillMarkdown, formatSkillsPrompt } from "./index"

function skillDir(root: string, id: string, md: string): string {
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "SKILL.md"), md)
  return dir
}

test("parseSkillMarkdown reads frontmatter name and description", () => {
  const raw = `---
name: ponytail
description: Be lazy and minimal.
---

# Ponytail

Do less.
`
  const s = parseSkillMarkdown(raw, "/tmp/ponytail")
  expect(s).toEqual({
    id: "ponytail",
    name: "ponytail",
    description: "Be lazy and minimal.",
    body: "# Ponytail\n\nDo less.\n",
    path: "/tmp/ponytail",
  })
})

test("parseSkillMarkdown falls back to folder id when no frontmatter", () => {
  const s = parseSkillMarkdown("# Hello\n\nBody", "/skills/hello-world")
  expect(s.id).toBe("hello-world")
  expect(s.name).toBe("hello-world")
  expect(s.description).toBe("")
  expect(s.body).toContain("# Hello")
})

test("discoverSkills finds SKILL.md under root folders", () => {
  const root = join(tmpdir(), "nexus-skills-" + Math.random().toString(36).slice(2))
  skillDir(
    root,
    "alpha",
    `---
name: alpha
description: First skill
---
# Alpha
`,
  )
  skillDir(root, "beta", "# Beta\n")
  mkdirSync(join(root, "empty"), { recursive: true })

  const found = discoverSkills([root])
  expect(found.map((s) => s.id).sort()).toEqual(["alpha", "beta"])
  expect(found.find((s) => s.id === "alpha")?.description).toBe("First skill")
})

test("discoverSkills prefers earlier roots on id collision", () => {
  const a = join(tmpdir(), "nexus-skills-a-" + Math.random().toString(36).slice(2))
  const b = join(tmpdir(), "nexus-skills-b-" + Math.random().toString(36).slice(2))
  skillDir(a, "shared", `---\nname: shared\ndescription: from-a\n---\n`)
  skillDir(b, "shared", `---\nname: shared\ndescription: from-b\n---\n`)
  const found = discoverSkills([a, b, join(tmpdir(), "nope-missing")])
  expect(found).toHaveLength(1)
  expect(found[0].description).toBe("from-a")
})

test("findSkill matches id or name", () => {
  const skills = [
    { id: "ponytail", name: "ponytail", description: "", body: "", path: "/x" },
    { id: "tdd", name: "Test Driven", description: "", body: "", path: "/y" },
  ]
  expect(findSkill(skills, "ponytail")?.id).toBe("ponytail")
  expect(findSkill(skills, "Test Driven")?.id).toBe("tdd")
  expect(findSkill(skills, "missing")).toBeUndefined()
})

test("filterSkills matches id name or description", () => {
  const skills = [
    { id: "ponytail", name: "ponytail", description: "be lazy", body: "", path: "/x" },
    { id: "tdd", name: "Test Driven", description: "red green", body: "", path: "/y" },
  ]
  expect(filterSkills(skills, "lazy").map((s) => s.id)).toEqual(["ponytail"])
  expect(filterSkills(skills, "driven").map((s) => s.id)).toEqual(["tdd"])
  expect(filterSkills(skills, "")).toHaveLength(2)
})

test("loadSkill reads a skill directory", () => {
  const root = join(tmpdir(), "nexus-skills-load-" + Math.random().toString(36).slice(2))
  const dir = skillDir(root, "tdd", `---\nname: tdd\ndescription: Test first\n---\n\nRed green.\n`)
  const s = loadSkill(dir)
  expect(s.name).toBe("tdd")
  expect(s.body).toContain("Red green.")
})

test("formatSkillsPrompt wraps active skill bodies", () => {
  const prompt = formatSkillsPrompt([
    {
      id: "ponytail",
      name: "ponytail",
      description: "lazy",
      body: "Do less.",
      path: "/x",
    },
  ])
  expect(prompt).toContain("[active-skills]")
  expect(prompt).toContain("## Skill: ponytail")
  expect(prompt).toContain("Do less.")
})

test("formatSkillsPrompt is empty when no skills", () => {
  expect(formatSkillsPrompt([])).toBe("")
})
