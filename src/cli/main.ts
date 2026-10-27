#!/usr/bin/env bun
import { defaultLegacySessionsDir, openSessionStore } from "../engine/store"
import { parseServeFlags, runServe } from "./serve"
import { runService } from "./service"
import { makeProvider, parseFlags, runSession, selfTest } from "./run"
import { runShell } from "../tui"

const argv = process.argv.slice(2)
const cmd = argv[0]

switch (cmd) {
  case "run": {
    const { yes, model, rest, format, attach } = parseFlags(argv.slice(1))
    const task = rest.join(" ")
    if (!task) {
      console.error('usage: nexus run "task" [--model <m>] [--yes] [--format ndjson] [--attach]')
      process.exit(1)
    }
    process.exit(await runSession({ task, yes, model, format, attach }))
  }
  case "resume": {
    const { yes, model, rest, format, attach } = parseFlags(argv.slice(1))
    const id = rest[0]
    if (!id) {
      console.error("usage: nexus resume <id> [--model <m>] [--yes] [--format ndjson] [--attach]")
      process.exit(1)
    }
    const store = openSessionStore()
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
        format,
        attach,
        task: loaded.messages.find((m) => m.role === "user")?.content,
      }),
    )
  }
  case "migrate": {
    const rest = argv.slice(1)
    const store = openSessionStore()
    const imported = store.importLegacy(rest[0] ?? defaultLegacySessionsDir())
    store.setKv("legacy_jsonl_imported_v1", new Date().toISOString())
    console.log(`imported ${imported} session(s) into ${store.path}`)
    store.close()
    break
  }
  case "self-test": {
    const { model } = parseFlags(argv.slice(1))
    const { provider } = makeProvider(model)
    process.exit(await selfTest(provider))
  }
  case "serve":
    await runServe(parseServeFlags(argv.slice(1)))
    break
  case "service":
    process.exit(await runService(argv.slice(1)))
    break
  case "--version":
    console.log("nexus 0.1.0")
    break
  case "--help":
    console.log(
      `usage: nexus                    # interactive shell
       nexus run "task" [--model <m>] [--yes] [--format ndjson] [--attach]
       nexus resume <id> [--model <m>] [--yes] [--format ndjson] [--attach]
       nexus serve [--port N] [--hostname H] [--token T]
       nexus service start|stop|status|token
       nexus migrate [jsonl-dir]         # one-time legacy import
       nexus self-test [--model <m>]
       nexus --help

exit codes: 0 done, 1 error, 2 aborted, 3 step limit`,
    )
    break
  case undefined:
    runShell()
    break
  default:
    console.log(`unknown command: ${cmd}`)
    process.exit(1)
}
