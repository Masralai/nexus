import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discoverInstructions, discoverInstructionsWithUrls, formatInstructions } from "./instructions"

function temp(): string {
  return mkdtempSync(join(tmpdir(), "nexus-instr-"))
}

test("discovers global then project files from root to cwd", () => {
  const root = temp()
  const nested = join(root, "packages", "app")
  mkdirSync(join(root, ".git"), { recursive: true })
  mkdirSync(nested, { recursive: true })
  writeFileSync(join(root, "AGENTS.md"), "root rules")
  writeFileSync(join(root, "packages", "AGENTS.md"), "package rules")
  writeFileSync(join(nested, "AGENTS.md"), "app rules")
  const globalDir = temp()
  writeFileSync(join(globalDir, "AGENTS.md"), "global rules")

  const files = discoverInstructions({ cwd: nested, globalDir })
  expect(files.map((f) => f.content)).toEqual([
    "global rules",
    "root rules",
    "package rules",
    "app rules",
  ])
})

test("does not walk past a non-repository cwd into unrelated parents", () => {
  const root = temp()
  const nested = join(root, "project")
  mkdirSync(nested)
  writeFileSync(join(root, "AGENTS.md"), "unrelated parent rules")
  writeFileSync(join(nested, "AGENTS.md"), "project rules")
  const files = discoverInstructions({ cwd: nested, includeUser: false })
  expect(files.map((f) => f.content)).toEqual(["project rules"])
})

test("resolves imports recursively with cycle detection", () => {
  const root = temp()
  writeFileSync(join(root, "AGENTS.md"), "top\n@docs/rules.md\n")
  mkdirSync(join(root, "docs"))
  writeFileSync(join(root, "docs", "rules.md"), "imported\n@loop.md\n")
  writeFileSync(join(root, "docs", "loop.md"), "loop\n@rules.md\n")

  const files = discoverInstructions({ cwd: root })
  const contents = files.map((f) => f.content)
  expect(contents).toContain("imported\n@loop.md\n")
  expect(contents).toContain("loop\n@rules.md\n")
  // Each file appears once even though it is reachable twice.
  expect(files.filter((f) => f.path.endsWith("rules.md"))).toHaveLength(1)
})

test("user instructions can be excluded for hermetic runs", () => {
  const root = temp()
  const globalDir = temp()
  writeFileSync(join(globalDir, "AGENTS.md"), "global rules")
  writeFileSync(join(root, "AGENTS.md"), "project rules")
  const files = discoverInstructions({ cwd: root, globalDir, includeUser: false })
  expect(files.map((f) => f.content)).toEqual(["project rules"])
})

test("formatInstructions emits path-attributed blocks", () => {
  const out = formatInstructions([
    { path: "/a/AGENTS.md", content: "alpha" },
    { path: "/b/AGENTS.md", content: "beta" },
  ])
  expect(out).toContain('<instructions path="/a/AGENTS.md">')
  expect(out).toContain("alpha")
  expect(out).toContain('<instructions path="/b/AGENTS.md">')
})

test("configured URLs are fetched after local files and failures are ignored", async () => {
  const root = temp()
  writeFileSync(join(root, "AGENTS.md"), "local rules")
  const files = await discoverInstructionsWithUrls({
    cwd: root,
    includeUser: false,
    extra: ["https://example.test/AGENTS.md", "https://example.test/missing.md"],
    fetchImpl: (async (url: string) =>
      String(url).includes("missing")
        ? new Response("nope", { status: 404 })
        : new Response("remote rules", { status: 200 })) as unknown as typeof fetch,
  })
  expect(files.map((f) => f.content)).toEqual(["local rules", "remote rules"])
  expect(files.at(-1)?.path).toBe("https://example.test/AGENTS.md")
})
