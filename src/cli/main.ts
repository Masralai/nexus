#!/usr/bin/env bun
import { createProvider } from "../providers"
import { defaultTools } from "../tools"
import { runTUI } from "../tui"
import { loadConfig } from "./config"

const argv = process.argv.slice(2)
const cmd = argv[0]

const rest = argv.slice(1)
const model = rest.includes("--model") ? rest[rest.indexOf("--model") + 1] : undefined
const task = rest.filter((a) => a !== "--model" && a !== model).join(" ")

switch (cmd) {
  case "run": {
    const cfg = loadConfig({ model })
    const apiKey = cfg.provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
    const provider = createProvider({
      provider: cfg.provider,
      model: cfg.model,
      apiKey: apiKey || undefined,
      baseUrl: process.env.OPENAI_BASE_URL,
    })
    runTUI({
      provider,
      registry: new Map(defaultTools().map((t) => [t.name, t])),
      cwd: process.cwd(),
      model: cfg.model || "(default)",
      maxSteps: cfg.maxSteps,
      task,
    })
    break
  }
  case "resume":
  case "self-test":
    console.log(`"${cmd}" lands in M5 — engine first`)
    process.exit(1)
  case "--version":
    console.log("nexus 0.1.0")
    break
  case "--help":
  case undefined:
    console.log('usage: harness run "task" [--model <m>]\n       harness --help')
    break
  default:
    console.log(`unknown command: ${cmd}`)
    process.exit(1)
}