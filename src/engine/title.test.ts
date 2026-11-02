import { expect, test } from "bun:test"
import { MockProvider } from "../providers/mock"
import { cleanTitle, generateTitle, maybeGenerateTitle, titleFromMessages } from "./title"
import type { Message, SessionMeta } from "./types"

test("cleanTitle removes quoting, prefixes, and extra whitespace", () => {
  expect(cleanTitle('Title: "Fix the failing tests."')).toBe("Fix the failing tests.")
  expect(cleanTitle("`add login flow`\nignored")).toBe("add login flow")
  expect(cleanTitle("   ")).toBeUndefined()
})

test("generateTitle asks for one short title from the first exchange", async () => {
  const provider = new MockProvider([{ content: '"Session title: Repair resume flow"' }])
  const messages: Message[] = [
    { role: "user", content: "why does resume duplicate messages" },
    { role: "assistant", content: "Because the turn re-appends the prompt." },
    { role: "user", content: "fix it" },
  ]
  expect(await generateTitle(provider, messages)).toBe("Repair resume flow")
  expect(provider.lastPrompt[0].role).toBe("user")
  expect((provider.lastPrompt[0] as { content: string }).content).toContain("why does resume duplicate messages")
})

test("generateTitle does not call the provider without a user message", async () => {
  const provider = new MockProvider([{ content: "unused" }])
  expect(await generateTitle(provider, [{ role: "assistant", content: "hello" }])).toBeUndefined()
  expect(provider.lastPrompt).toEqual([])
})

test("generateTitle reports title-model usage to the caller", async () => {
  const provider = new MockProvider([
    { content: "Repair resume flow", usage: { inputTokens: 30, outputTokens: 4 } },
  ])
  const usage: unknown[] = []
  await generateTitle(provider, [{ role: "user", content: "fix resume" }], {
    onUsage: (value) => usage.push(value),
  })
  expect(usage).toEqual([{ inputTokens: 30, outputTokens: 4 }])
})

test("maybeGenerateTitle replaces the fallback and accounts for usage", async () => {
  const meta: SessionMeta = {
    id: "s1",
    cwd: "/tmp",
    model: "gpt-4o",
    provider: "openai-compatible",
    createdAt: "2026-10-22T00:00:00.000Z",
    title: "fix resume",
  }
  let title: string | undefined
  const usage: unknown[] = []
  const store = {
    load: () => ({
      meta,
      messages: [
        { role: "user" as const, content: "fix resume" },
        { role: "assistant" as const, content: "done" },
      ],
    }),
    rename: (_id: string, value: string) => {
      title = value
    },
    addUsage: (_id: string, value: unknown) => {
      usage.push(value)
    },
  }
  const provider = new MockProvider([
    { content: "Repair resume flow", usage: { inputTokens: 30, outputTokens: 4 } },
  ])
  expect(
    await maybeGenerateTitle(store, "s1", provider, { model: "gpt-4o" }),
  ).toBe("Repair resume flow")
  expect(title).toBe("Repair resume flow")
  expect(usage).toHaveLength(1)
})

test("titleFromMessages ignores synthetic compaction summaries", () => {
  expect(
    titleFromMessages([
      { role: "user", content: "old summary", synthetic: "compaction" },
      { role: "user", content: "real question" },
    ]),
  ).toBe("real question")
})
