import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

export interface Skill {
  id: string
  name: string
  description: string
  body: string
  path: string
}

const MAX_BODY = 12_000

/** Default skill roots (first match wins on id collision). */
export function defaultSkillRoots(): string[] {
  const home = homedir()
  // Project wins over home (last listed loses on id collision — we insert project first).
  return [
    join(process.cwd(), ".agents", "skills"),
    join(home, ".agents", "skills"),
    join(home, ".claude", "skills"),
    join(home, ".cursor", "skills-cursor"),
  ]
}

function stripQuotes(v: string): string {
  const t = v.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

/** Minimal YAML frontmatter parse for name/description (folded `>` supported for description). */
export function parseSkillMarkdown(raw: string, skillPath: string): Skill {
  const id = basename(skillPath)
  let name = id
  let description = ""
  let body = raw

  if (raw.startsWith("---")) {
    const end = raw.indexOf("\n---", 3)
    if (end !== -1) {
      const fm = raw.slice(3, end).trim()
      body = raw.slice(end + 4).replace(/^\r?\n+/, "")
      let key = ""
      let folding = false
      let foldBuf: string[] = []
      for (const line of fm.split("\n")) {
        if (folding) {
          if (/^\s+\S/.test(line) || line.trim() === ">") {
            foldBuf.push(line.trim().replace(/^>/, "").trim())
            continue
          }
          if (key === "description") description = foldBuf.filter(Boolean).join(" ").trim()
          folding = false
          foldBuf = []
        }
        const m = /^(\w+):\s*(.*)$/.exec(line)
        if (!m) continue
        key = m[1]
        const val = m[2]
        if (key === "name") name = stripQuotes(val) || id
        else if (key === "description") {
          if (val.trim() === ">" || val.trim() === "|") {
            folding = true
            foldBuf = []
          } else description = stripQuotes(val)
        }
      }
      if (folding && key === "description") {
        description = foldBuf.filter(Boolean).join(" ").trim()
      }
    }
  }

  return { id, name, description, body, path: skillPath }
}

export function loadSkill(dir: string): Skill {
  const file = join(dir, "SKILL.md")
  const raw = readFileSync(file, "utf8")
  return parseSkillMarkdown(raw, dir)
}

export function discoverSkills(roots: string[] = defaultSkillRoots()): Skill[] {
  const byId = new Map<string, Skill>()
  for (const root of roots) {
    if (!existsSync(root)) continue
    let entries: string[]
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const name of entries) {
      const dir = join(root, name)
      const file = join(dir, "SKILL.md")
      if (!existsSync(file)) continue
      if (byId.has(name)) continue
      try {
        byId.set(name, loadSkill(dir))
      } catch {
        /* skip unreadable */
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function formatSkillsPrompt(skills: Skill[]): string {
  if (skills.length === 0) return ""
  const blocks = skills.map((s) => {
    const body = s.body.length <= MAX_BODY ? s.body : `${s.body.slice(0, MAX_BODY)}\n[...truncated skill]`
    return `## Skill: ${s.name}\n${body.trim()}`
  })
  return `[active-skills]\nFollow these skills for this session:\n\n${blocks.join("\n\n")}`
}

export function findSkill(skills: Skill[], query: string): Skill | undefined {
  const q = query.toLowerCase()
  return skills.find((s) => s.id.toLowerCase() === q || s.name.toLowerCase() === q)
}

export function filterSkills(skills: Skill[], query: string): Skill[] {
  const q = query.trim().toLowerCase()
  if (!q) return skills
  return skills.filter(
    (s) =>
      s.id.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q),
  )
}
