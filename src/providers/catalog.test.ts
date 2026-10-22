import { expect, test } from "bun:test"
import { estimateCost, getModelInfo } from "./catalog"

test("unknown models fall back without guessing capabilities", () => {
  const info = getModelInfo("some-future-model")
  expect(info.id).toBe("unknown")
  expect(info.tools).toBe(true)
})

test("catalog resolves snapshots and provider-prefixed ids", () => {
  expect(getModelInfo("claude-sonnet-4-20250514").id).toBe("claude-sonnet-4-20250514")
  expect(getModelInfo("anthropic/claude-sonnet-4-20250514").id).toBe("claude-sonnet-4-20250514")
  expect(getModelInfo("gpt-4o-mini-2024-07-18").id).toBe("gpt-4o-mini")
})

test("cost prices cache reads and writes on top of total input", () => {
  const info = getModelInfo("claude-sonnet-4-20250514") // 3 / 15 per Mtok
  const plain = estimateCost(info, { inputTokens: 1_000_000, outputTokens: 0 })
  expect(plain).toBeCloseTo(3, 5)
  const cached = estimateCost(info, {
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheReadTokens: 1_000_000,
  })
  expect(cached).toBeCloseTo(0.3, 5)
  const written = estimateCost(info, {
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheWriteTokens: 1_000_000,
  })
  expect(written).toBeCloseTo(3.75, 5)
})
