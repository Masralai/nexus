import { expect, test } from "bun:test"
import { PtyManager } from "./pty"

test("lists, writes to, updates, and removes interactive PTY sessions", async () => {
  const pty = new PtyManager()
  try {
    const info = pty.create("test-pty", { title: "demo" })
    expect(info).toMatchObject({ id: "test-pty", title: "demo", status: "running" })
    expect(pty.list().map((item) => item.id)).toContain("test-pty")

    pty.write("test-pty", "echo pty-ready\n")
    const deadline = Date.now() + 3_000
    let output = pty.output("test-pty").data
    while (!output.includes("pty-ready") && Date.now() < deadline) {
      await Bun.sleep(10)
      output = pty.output("test-pty").data
    }
    expect(output).toContain("pty-ready")
    expect(pty.update("test-pty", { title: "renamed" }).title).toBe("renamed")

    pty.remove("test-pty")
    expect(pty.get("test-pty")).toBeUndefined()
  } finally {
    pty.close()
  }
})
