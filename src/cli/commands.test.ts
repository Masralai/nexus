import { expect, test } from "bun:test"
import { configuredCommands, expandCommand, findAgent, findCommand } from "./commands"
import type { NexusConfig } from "./config"

function config(over: Partial<NexusConfig> = {}): NexusConfig {
  return {
    provider: "mock",
    preset: "mock",
    model: "mock",
    maxSteps: 5,
    compactModel: "mock",
    compactThreshold: 0.8,
    ...over,
  }
}

test("command templates expand arguments and positionals", () => {
  expect(expandCommand("Review $ARGUMENTS carefully", "src/a.ts src/b.ts")).toBe("Review src/a.ts src/b.ts carefully")
  expect(expandCommand("Fix {args}", "this bug")).toBe("Fix this bug")
  expect(expandCommand("Test $1 then $2", "unit e2e")).toBe("Test unit then e2e")
  expect(expandCommand("No args", "")).toBe("No args")
})

test("configured commands normalize strings and objects", () => {
  const cfg = config({
    commands: {
      review: "Review $ARGUMENTS",
      deploy: { template: "Deploy $1", description: "ship it", agent: "release", model: "gpt-4o" },
    },
  })
  expect(configuredCommands(cfg).map((command) => command.name)).toEqual(["deploy", "review"])
  expect(findCommand(cfg, "DEPLOY")).toEqual({
    name: "deploy",
    template: "Deploy $1",
    description: "ship it",
    agent: "release",
    model: "gpt-4o",
  })
  expect(findCommand(cfg, "missing")).toBeUndefined()
})

test("agents resolve case-insensitively", () => {
  const cfg = config({ agents: { Release: { description: "ship", prompt: "be careful", tools: ["read"] } } })
  expect(findAgent(cfg, "release")).toEqual({
    id: "Release",
    config: { description: "ship", prompt: "be careful", tools: ["read"] },
  })
})
