#!/usr/bin/env bun
import { readFileSync } from "node:fs"
import { compareTranscripts, type Transcript } from "../src/parity/harness"

function parse(text: string, source: string): Transcript {
  const trimmed = text.trim()
  if (!trimmed) return { events: [] }
  try {
    const parsed = JSON.parse(trimmed) as Transcript | Array<Record<string, unknown>>
    if (Array.isArray(parsed)) return { events: parsed }
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.events)) return parsed
    return { events: [parsed as Record<string, unknown>] }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        events: trimmed.split("\n").flatMap((line) => (line.trim() ? [JSON.parse(line) as Record<string, unknown>] : [])),
      }
    }
    throw error
  }
}

function load(path: string): Transcript {
  return parse(readFileSync(path, "utf8"), path)
}

function run(command: string, fixture?: string): Transcript {
  const proc = Bun.spawnSync({
    cmd: ["bash", "-lc", command],
    env: { ...process.env, ...(fixture ? { PARITY_FIXTURE: fixture } : {}) },
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = proc.stdout.toString()
  if (proc.exitCode !== 0 && !stdout.trim()) {
    throw new Error(`${command}: exit ${proc.exitCode}\n${proc.stderr.toString()}`)
  }
  return parse(stdout, command)
}

const args = process.argv.slice(2)
const take = (flag: string): string | undefined => {
  const index = args.indexOf(flag)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (value === undefined) throw new Error(`${flag} needs a value`)
  args.splice(index, 2)
  return value
}
const maxRaw = take("--max-prompt-growth")
const fixture = take("--fixture")
const actualCommand = take("--actual-command")
const referenceCommand = take("--reference-command")
const max = maxRaw !== undefined ? Number(maxRaw) : undefined

let actual: Transcript
let reference: Transcript
if (actualCommand || referenceCommand) {
  if (!actualCommand || !referenceCommand) {
    console.error("--actual-command and --reference-command must be used together")
    process.exit(2)
  }
  actual = run(actualCommand, fixture)
  reference = run(referenceCommand, fixture)
} else {
  if (args.length !== 2) {
    console.error(
      "usage: bun scripts/parity.ts <actual.json|jsonl> <reference.json|jsonl> [--max-prompt-growth 5]\n" +
        "   or: bun scripts/parity.ts --actual-command <cmd> --reference-command <cmd> [--fixture path]",
    )
    process.exit(2)
  }
  actual = load(args[0])
  reference = load(args[1])
}
const report = compareTranscripts(actual, reference, max !== undefined ? { maxPromptGrowthPct: max } : {})
console.log(JSON.stringify(report, null, 2))
process.exit(report.ok ? 0 : 1)
