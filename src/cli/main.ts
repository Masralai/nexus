#!/usr/bin/env bun
import { JSONLStore } from "../engine/state"
import { makeProvider, parseFlags, runSession, selfTest } from "./run"

const argv = process.argv.slice(2)
const cmd = argv[0]
const { yes, model, rest } = parseFlags(argv.slice(1))

switch (cmd) {
  case "run": {
    const task = rest.join(" ")
    if (!task) {
      console.error('usage: harness run "task" [--model <m>] [--yes]')
      process.exit(1)
    }
    process.exit(await runSession({ task, yes, model }))
  }
  case "resume": {
    const id = rest[0]
    if (!id) {
      console.error("usage: harness resume <id> [--model <m>] [--yes]")
      process.exit(1)
    }
    const store = new JSONLStore()
    const loaded = store.load(id)
    process.exit(
      await runSession({
        messages: loaded.messages,
        sessionId: loaded.meta.id,
        cwd: loaded.meta.cwd,
        model: model ?? loaded.meta.model,
        yes,
        resume: true,
        store,
        task: loaded.messages.find((m) => m.role === "user")?.content,
      }),
    )
  }
  case "self-test": {
    const { provider } = makeProvider(model)
    process.exit(await selfTest(provider))
  }
  case "--version":
    console.log("nexus 0.1.0")
    break
  case "--help":
  case undefined:
    console.log(
      `usage: harness run "task" [--model <m>] [--yes]
       harness resume <id> [--model <m>] [--yes]
       harness self-test [--model <m>]
       harness --help`,
    )
    break
  default:
    console.log(`unknown command: ${cmd}`)
    process.exit(1)
}
