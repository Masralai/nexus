import { expect, test } from "bun:test"
import { createProvider } from "./index"

test("createProvider maps names to adapters", () => {
  expect(createProvider({ provider: "anthropic", model: "claude" }).id).toBe("anthropic")
  expect(createProvider({ provider: "mock", model: "" }).id).toBe("mock")
  const o = createProvider({ provider: "deepseek", model: "deepseek-chat", apiKey: "k", baseUrl: "https://api.deepseek.com/v1" })
  expect(o.id).toBe("openai-compatible")
  expect(o.contextWindow).toBe(128_000)
})