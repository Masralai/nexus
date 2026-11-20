import { expect, test } from "bun:test"
import { PtyManager, screenState } from "./pty"

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

test("screenState tracks newline and carriage return", () => {
  const screen = screenState("hi\nab", 80, 40)
  expect(screen.text).toBe("hi\nab")
  expect(screen.cursor).toEqual({ x: 2, y: 1 })
  expect(screenState("ab\rz", 80, 40)).toMatchObject({ text: "abz", cursor: { x: 1, y: 0 } })
})

test("screenState handles backspace and cursor moves", () => {
  expect(screenState("ab\b", 80, 40).cursor).toEqual({ x: 1, y: 0 })
  expect(screenState("ab\x1b[1D", 80, 40).cursor).toEqual({ x: 1, y: 0 })
  expect(screenState("a\x1b[2C", 80, 40).cursor).toEqual({ x: 3, y: 0 })
})

test("screenState applies cursor addressing and clamps to bounds", () => {
  expect(screenState("\x1b[3;5Hab", 80, 40).cursor).toEqual({ x: 6, y: 2 })
  expect(screenState("x", 1, 1).cursor).toEqual({ x: 0, y: 0 })
  expect(screenState("\x1b[9;9H", 2, 2).cursor).toEqual({ x: 1, y: 1 })
})
