import { expect, test } from "bun:test"
import { filterSlashCommands, parseSlash } from "./slash"

test("slash parse extracts command", () => {
  expect(parseSlash("/help")).toBe("help")
  expect(parseSlash("/key extra")).toBe("key")
  expect(parseSlash("/QUIT")).toBe("quit")
})

test("filterSlashCommands lists all on bare /", () => {
  const ids = filterSlashCommands("/").map((c) => c.id)
  expect(ids).toContain("key")
  expect(ids).toContain("model")
  expect(ids).toContain("plan")
  expect(ids).toContain("build")
  expect(ids).toContain("help")
  expect(ids).not.toContain("exit")
})

test("filterSlashCommands prefixes", () => {
  expect(filterSlashCommands("/m").map((c) => c.id)).toEqual(["model"])
  expect(filterSlashCommands("/p").map((c) => c.id)).toEqual(["plan"])
  expect(filterSlashCommands("/b").map((c) => c.id)).toEqual(["build"])
  expect(filterSlashCommands("/re").map((c) => c.id)).toEqual(["resume"])
  expect(filterSlashCommands("/zzz")).toEqual([])
})
