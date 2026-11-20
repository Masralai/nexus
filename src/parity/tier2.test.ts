import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { summarize } from "../../scripts/parity-tier2"
import type { Transcript } from "./harness"

function t(steps: number, costValue = 1): Transcript {
  return {
    events: [{ type: "runComplete", steps }, { usage: { inputTokens: 10, outputTokens: 5 }, cost: costValue }],
    parts: [{ type: "text" }],
    status: "runComplete",
  }
}

test("tier2 summarize: pass rate and medians", () => {
  const s = summarize([
    { task: "a", run: 1, actual: t(1, 2), reference: t(1, 1), actualMs: 100, referenceMs: 90 },
    { task: "a", run: 2, actual: t(2, 2), reference: t(1, 1), actualMs: 200, referenceMs: 100 },
  ])
  expect(s.actual.passRate).toBe(1)
  expect(s.reference.passRate).toBe(1)
  expect(s.actual.medianSteps).toBe(1.5)
  expect(s.reference.medianSteps).toBe(1)
  expect(s.actual.medianCost).toBe(2)
  expect(s.actual.medianTokens).toBe(15)
  expect(s.comparisons).toHaveLength(2)
})

test("tier2 CLI runs command producers per task/run", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-tier2-"))
  try {
    const tasks = join(dir, "tasks.json")
    writeFileSync(tasks, JSON.stringify({ runs: 2, tasks: [{ id: "t1", prompt: "hi" }] }))
    const cmd = 'echo \'{"events":[{"type":"runComplete","steps":1}],"parts":[{"type":"text"}],"status":"runComplete"}\''
    const proc = Bun.spawnSync({
      cmd: ["bun", join(import.meta.dir, "../../scripts/parity-tier2.ts"), "--tasks", tasks, "--actual-command", cmd, "--reference-command", cmd, "--out", join(dir, "out"), "--runs", "2"],
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(proc.exitCode).toBe(0)
    const report = JSON.parse(proc.stdout.toString()) as { summary: { runs: number; tasks: number } }
    expect(report.summary).toMatchObject({ runs: 2, tasks: 1 })
    expect(JSON.parse(readFileSync(join(dir, "out", "summary.json"), "utf8"))).toMatchObject({ summary: { runs: 2 } })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
