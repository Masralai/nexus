import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("parity CLI runs command producers with PARITY_FIXTURE", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-parity-"))
  const fixture = join(dir, "fixture.json")
  writeFileSync(
    fixture,
    `${JSON.stringify({ events: [{ type: "toolCallStarted", name: "read" }, { type: "runComplete", steps: 1, result: "done" }] })}\n`,
  )
  try {
    const command = 'cat "$PARITY_FIXTURE"'
    const proc = Bun.spawnSync({
      cmd: [
        "bun",
        join(import.meta.dir, "../../scripts/parity.ts"),
        "--actual-command",
        command,
        "--reference-command",
        command,
        "--fixture",
        fixture,
      ],
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(proc.exitCode).toBe(0)
    expect(JSON.parse(proc.stdout.toString())).toMatchObject({ ok: true, failures: [] })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
