import { expect, test } from "bun:test"
import { parseMouseInput, parseMouseEvent } from "./mouse"

test("parseMouseInput maps SGR wheel up and down", () => {
  expect(parseMouseInput("\x1b[<64;10;20M")).toBe("up")
  expect(parseMouseInput("\x1b[<65;10;20M")).toBe("down")
  expect(parseMouseInput("[<64;57;31M")).toBe("up")
  expect(parseMouseInput("[<65;51;17M")).toBe("down")
  expect(parseMouseInput("\x1b[A")).toBeNull()
})

test("parseMouseInput swallows other SGR mouse events", () => {
  expect(parseMouseInput("\x1b[<0;10;20M")).toBe("ignore")
  expect(parseMouseInput("\x1b[<35;12;4M")).toBe("ignore")
  expect(parseMouseInput("[<0;10;20M")).toBe("ignore")
})

test("parseMouseInput swallows legacy mouse packets", () => {
  expect(parseMouseInput("\x1b[M !!")).toBe("ignore")
})

test("parseMouseEvent extracts press coordinates", () => {
  const ev = parseMouseEvent("\x1b[<0;15;25M")
  expect(ev).toEqual({ type: "press", button: 0, col: 14, row: 24 })
})

test("parseMouseEvent extracts release coordinates", () => {
  const ev = parseMouseEvent("\x1b[<0;15;25m")
  expect(ev).toEqual({ type: "release", button: 0, col: 14, row: 24 })
})

test("parseMouseEvent extracts drag coordinates", () => {
  const ev = parseMouseEvent("\x1b[<32;10;5M")
  expect(ev).toEqual({ type: "drag", button: 0, col: 9, row: 4 })
})

test("parseMouseEvent identifies wheel events", () => {
  const up = parseMouseEvent("\x1b[<64;10;20M")
  expect(up).toEqual({ type: "wheel", button: 4, col: 9, row: 19 })

  const down = parseMouseEvent("\x1b[<65;10;20M")
  expect(down).toEqual({ type: "wheel", button: 5, col: 9, row: 19 })
})

test("parseMouseEvent returns null for non-mouse input", () => {
  expect(parseMouseEvent("\x1b[A")).toBeNull()
  expect(parseMouseEvent("hello")).toBeNull()
})
