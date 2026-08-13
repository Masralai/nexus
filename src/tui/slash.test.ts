import { expect, test } from "bun:test"

function parseSlash(raw: string): string {
  return raw.slice(1).trim().split(/\s+/)[0]?.toLowerCase() ?? ""
}

test("slash parse extracts command", () => {
  expect(parseSlash("/help")).toBe("help")
  expect(parseSlash("/key extra")).toBe("key")
  expect(parseSlash("/QUIT")).toBe("quit")
})
