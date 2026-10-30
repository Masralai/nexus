import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadPlugins } from "./load"

function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nexus-plugins-"))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return dir
}

test("local plugins register tools and observe chat params", async () => {
  const dir = workspace({
    "good.ts": `
      export default function (input) {
        return {
          name: "fixture",
          registerTools: () => [{
            name: "fixture_tool",
            description: "from a plugin",
            schema: {},
            async execute() { return { ok: true, output: input.options?.label ?? "plugin" } },
          }],
          chatParams: (params) => ({ ...params, temperature: 0 }),
        }
      }
    `,
  })
  try {
    const { registry, errors } = await loadPlugins([{ path: "./good.ts", options: { label: "loaded" } }], { cwd: dir })
    expect(errors).toEqual([])
    const tools = registry.tools([], { cwd: dir })
    expect(tools.map((tool) => tool.name)).toEqual(["fixture_tool"])
    expect((await tools[0].execute({}, { cwd: dir })).output).toBe("loaded")
    expect(registry.chatParams({ model: "m" }, { cwd: dir })).toEqual({ model: "m", temperature: 0 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a broken plugin is isolated from the rest", async () => {
  const dir = workspace({
    "bad.ts": `throw new Error("boom")`,
    "good.ts": `export default { name: "good" }`,
  })
  try {
    const { registry, errors } = await loadPlugins(["./bad.ts", "./good.ts"], { cwd: dir })
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain("boom")
    expect(registry.list().map((plugin) => plugin.name)).toEqual(["good"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("directory plugins resolve index files", async () => {
  const dir = workspace({})
  const pluginDir = join(dir, "plugin")
  mkdirSync(pluginDir)
  writeFileSync(join(pluginDir, "index.ts"), `export default { name: "dir-plugin" }`)
  try {
    const { registry, errors } = await loadPlugins(["./plugin"], { cwd: dir })
    expect(errors).toEqual([])
    expect(registry.list().map((plugin) => plugin.name)).toEqual(["dir-plugin"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
