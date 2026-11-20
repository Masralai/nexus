#!/usr/bin/env bun
/**
 * Tier 2 (release-only, live models): run scripted tasks N times per subject,
 * collect each run's transcript (and optional wall-clock/cost metadata), then
 * compare Nexus vs the pinned reference with the structural comparator and
 * summarize rates/medians.
 *
 * No live runs here; this script only orchestrates commands you supply.
 *
 *   bun scripts/parity-tier2.ts --tasks fixtures/parity/tier2-tasks.json \
 *     --actual-command "<cmd>" --reference-command "<cmd>" \
 *     --out /tmp/tier2
 *
 * Each command runs with env: PARITY_TASK, PARITY_RUN, PARITY_PROMPT and must
 * print a JSON transcript to stdout. Wall clock is recorded by this runner.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { compareTranscripts, type Transcript } from "../src/parity/harness"

interface Task { id: string; prompt: string }
interface TaskList { pin?: unknown; runs?: number; tasks: Task[] }

function parse(text: string): Transcript {
  const trimmed = text.trim()
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) return { events: parsed as Array<Record<string, unknown>> }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as Transcript).events)) return parsed as Transcript
    return { events: [parsed as Record<string, unknown>] }
  } catch {
    return {
      events: trimmed.split("\n").flatMap((line) => (line.trim() ? [JSON.parse(line) as Record<string, unknown>] : [])),
    }
  }
}

function take(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  if (i < 0) return undefined
  const v = args[i + 1]
  if (v === undefined) throw new Error(`${flag} needs a value`)
  args.splice(i, 2)
  return v
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1]! + s[m]!) / 2
}

function p95(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]
}

function runOne(command: string, task: Task, run: number): { transcript: Transcript; wallClockMs: number } {
  const t0 = Date.now()
  const proc = Bun.spawnSync({
    cmd: ["bash", "-lc", command],
    env: { ...process.env, PARITY_TASK: task.id, PARITY_RUN: String(run), PARITY_PROMPT: task.prompt },
    stdout: "pipe",
    stderr: "pipe",
  })
  const wallClockMs = Date.now() - t0
  const stdout = proc.stdout.toString()
  if (proc.exitCode !== 0 && !stdout.trim()) {
    throw new Error(`${command}: exit ${proc.exitCode}\n${proc.stderr.toString()}`)
  }
  const transcript = parse(stdout)
  if (transcript.exitCode === undefined) transcript.exitCode = proc.exitCode ?? undefined
  return { transcript, wallClockMs }
}

function tokens(t: Transcript): number | undefined {
  for (let i = t.events.length - 1; i >= 0; i--) {
    const e = t.events[i] as { usage?: { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number } } | undefined
    const u = e?.usage
    if (!u) continue
    const a = (u.inputTokens ?? u.promptTokens ?? 0) + (u.outputTokens ?? u.completionTokens ?? 0)
    if (a > 0) return a
  }
  return undefined
}

function cost(t: Transcript): number | undefined {
  for (let i = t.events.length - 1; i >= 0; i--) {
    const e = t.events[i] as { cost?: number } | undefined
    if (typeof e?.cost === "number") return e.cost
  }
  return undefined
}

function steps(t: Transcript): number | undefined {
  for (let i = t.events.length - 1; i >= 0; i--) {
    const e = t.events[i] as { type?: string; steps?: number } | undefined
    if (e?.type === "runComplete" && typeof e.steps === "number") return e.steps
  }
  return undefined
}

function passed(t: Transcript): boolean {
  if (t.status === "runComplete") return true
  return t.events.some((e) => e.type === "runComplete")
}

export interface Tier2Summary {
  tasks: number
  runs: number
  actual: { passRate: number; medianSteps?: number; medianTokens?: number; medianCost?: number; p95WallClockMs?: number }
  reference: { passRate: number; medianSteps?: number; medianTokens?: number; medianCost?: number; p95WallClockMs?: number }
  comparisons: Array<{ task: string; run: number; ok: boolean; failures: string[] }>
}

export function summarize(
  results: Array<{ task: string; run: number; actual: Transcript; reference: Transcript; actualMs: number; referenceMs: number }>,
): Tier2Summary {
  const agg = (pick: (r: { t: Transcript; ms: number }) => { t: Transcript; ms: number }, side: "actual" | "reference") => {
    const rows = results.map((r) => pick(side === "actual" ? { t: r.actual, ms: r.actualMs } : { t: r.reference, ms: r.referenceMs }))
    const transcripts = rows.map((r) => r.t)
    const passRate = transcripts.length ? transcripts.filter(passed).length / transcripts.length : 0
    return {
      passRate,
      medianSteps: median(transcripts.map(steps).filter((n): n is number => n !== undefined)),
      medianTokens: median(transcripts.map(tokens).filter((n): n is number => n !== undefined)),
      medianCost: median(transcripts.map(cost).filter((n): n is number => n !== undefined)),
      p95WallClockMs: p95(rows.map((r) => r.ms)),
    }
  }
  const comparisons = results.map((r) => {
    const c = compareTranscripts(r.actual, r.reference)
    return { task: r.task, run: r.run, ok: c.ok, failures: c.failures }
  })
  return {
    tasks: new Set(results.map((r) => r.task)).size,
    runs: results.length,
    actual: agg((x) => x, "actual"),
    reference: agg((x) => x, "reference"),
    comparisons,
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const tasksPath = take(args, "--tasks")
  const actualCommand = take(args, "--actual-command")
  const referenceCommand = take(args, "--reference-command")
  const outDir = take(args, "--out")
  const runsOverride = take(args, "--runs")
  if (!tasksPath || !actualCommand || !referenceCommand || !outDir) {
    console.error("usage: bun scripts/parity-tier2.ts --tasks <tasks.json> --actual-command <cmd> --reference-command <cmd> --out <dir> [--runs N]")
    process.exit(2)
  }
  const list = JSON.parse(readFileSync(tasksPath, "utf8")) as TaskList
  const runs = runsOverride ? Number(runsOverride) : (list.runs ?? 3)
  mkdirSync(outDir, { recursive: true })
  const results: Array<{ task: string; run: number; actual: Transcript; reference: Transcript; actualMs: number; referenceMs: number }> = []
  for (const task of list.tasks) {
    for (let run = 1; run <= runs; run++) {
      const a = runOne(actualCommand, task, run)
      const r = runOne(referenceCommand, task, run)
      writeFileSync(join(outDir, `${task.id}.run${run}.actual.json`), JSON.stringify(a.transcript, null, 2))
      writeFileSync(join(outDir, `${task.id}.run${run}.reference.json`), JSON.stringify(r.transcript, null, 2))
      results.push({ task: task.id, run, actual: a.transcript, reference: r.transcript, actualMs: a.wallClockMs, referenceMs: r.wallClockMs })
    }
  }
  const report = { pin: list.pin, summary: summarize(results) }
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.summary.comparisons.every((c) => c.ok) ? 0 : 1)
}
