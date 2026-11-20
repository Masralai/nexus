import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { renderSdk } from "../../scripts/sdk-generate"

test("generated SDK surface matches the route contract", () => {
  const committed = readFileSync(join(import.meta.dir, "../../src/sdk/generated.ts"), "utf8")
  expect(committed).toBe(renderSdk())
})

test("generated SDK surface skips stream routes", () => {
  const source = renderSdk()
  expect(source).not.toContain('events: (')
  expect(source).not.toContain('sessionEvents: (')
  expect(source).not.toContain('ptyConnect: (')
})
