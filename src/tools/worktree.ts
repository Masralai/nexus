import type { Tool } from "../engine/types"

function unavailable(): { ok: false; output: string; error: string } {
  return { ok: false, output: "", error: "git worktrees unavailable in this runtime" }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export const worktree_create: Tool = {
  name: "worktree_create",
  description:
    "Create an isolated git worktree with its own branch. Input: { name?, branch?, from?, directory? }. Use this before large or risky changes so the main working tree stays clean.",
  schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      branch: { type: "string" },
      from: { type: "string" },
      directory: { type: "string" },
    },
  },
  readonly: false,
  outputLimit: 4_000,
  async execute(input, ctx) {
    if (!ctx.worktree) return unavailable()
    try {
      const result = await ctx.worktree.create((input ?? {}) as { name?: string; branch?: string; from?: string; directory?: string })
      return { ok: true, output: `created worktree ${result.directory} on branch ${result.branch}` }
    } catch (e) {
      return { ok: false, output: "", error: errorText(e) }
    }
  },
}

export const worktree_list: Tool = {
  name: "worktree_list",
  description: "List git worktrees for the current repository. Input: {}.",
  schema: { type: "object", properties: {} },
  readonly: true,
  outputLimit: 8_000,
  async execute(_input, ctx) {
    if (!ctx.worktree) return unavailable()
    try {
      const entries = await ctx.worktree.list()
      if (entries.length === 0) return { ok: true, output: "no worktrees" }
      return {
        ok: true,
        output: entries
          .map((entry) => {
            const branch = entry.branch ?? "(detached)"
            return `${entry.root ? "* " : "  "}${entry.directory} ${branch}${entry.commit ? ` ${entry.commit.slice(0, 12)}` : ""}`
          })
          .join("\n"),
      }
    } catch (e) {
      return { ok: false, output: "", error: errorText(e) }
    }
  },
}

export const worktree_remove: Tool = {
  name: "worktree_remove",
  description:
    "Remove a git worktree created for this repository. Input: { directory, force? }. Use force only after confirming the worktree has no uncommitted work you need.",
  schema: {
    type: "object",
    properties: { directory: { type: "string" }, force: { type: "boolean" } },
    required: ["directory"],
  },
  readonly: false,
  outputLimit: 4_000,
  async execute(input, ctx) {
    if (!ctx.worktree) return unavailable()
    const { directory, force } = (input ?? {}) as { directory?: string; force?: boolean }
    if (typeof directory !== "string" || !directory.trim()) {
      return { ok: false, output: "", error: "worktree_remove requires a directory" }
    }
    try {
      await ctx.worktree.remove({ directory, ...(force ? { force: true } : {}) })
      return { ok: true, output: `removed worktree ${directory}` }
    } catch (e) {
      return { ok: false, output: "", error: errorText(e) }
    }
  },
}
