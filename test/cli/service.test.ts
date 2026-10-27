import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startManagedService, stopManagedService } from "../../src/cli/service"
import { NexusClient } from "../../src/sdk/client"
import { discoverService } from "../../src/server/state"

test("managed service start, token, and stop", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-svc-"))
  try {
    const info = await startManagedService({
      stateDir: dir,
      port: 0,
      hostname: "127.0.0.1",
      token: "svc-token",
    })
    expect(info.password).toBe("svc-token")
    expect(discoverService(dir)?.pid).toBe(info.pid)
    const client = new NexusClient({ url: info.url, token: info.password })
    const remote = await client.info()
    expect(remote.pid).toBe(info.pid)
    expect(await stopManagedService(dir)).toBe(true)
    expect(discoverService(dir)).toBeUndefined()
  } finally {
    await stopManagedService(dir).catch(() => undefined)
    rmSync(dir, { recursive: true, force: true })
  }
})
