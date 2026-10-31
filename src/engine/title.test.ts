import { expect, test } from "bun:test"
import { MockProvider } from "../providers/mock"
import { cleanTitle, generateTitle, titleFromMessages } from "./title"
import type { Message } from "./types"

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

test("titleFromMessages ignores synthetic compaction summaries", () => {
  expect(
    titleFromMessages([
      { role: "user", content: "old summary", synthetic: "compaction" },
      { role: "user", content: "real question" },
    ]),
  ).toBe("real question")
})
