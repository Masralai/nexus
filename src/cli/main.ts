#!/usr/bin/env bun
import { loadConfig } from "./config"

const argv = process.argv.slice(2)
const cmd = argv[0]

const rest = argv.slice(1)
const model = rest.includes("--model") ? rest[rest.indexOf("--model") + 1] : undefined
const task = rest.filter((a) => a !== "--model" && a !== model).join(" ")

switch (cmd) {
  case "run": {
    const cfg = loadConfig({ model })
    console.log(`task: ${task || "(none)"}`)
    console.log(`provider=${cfg.provider} model=${cfg.model || "(default)"} maxSteps=${cfg.maxSteps}`)
    console.log("engine not built yet — lands in M1")
    process.exit(1)
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