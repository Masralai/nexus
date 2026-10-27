import { NexusClient, type WireEvent } from "../sdk/client"
import { discoverService } from "../server/state"

export async function runAttached(opts: {
  task: string
  yes: boolean
  model?: string
  format: "text" | "ndjson"
  cwd: string
  write?: (s: string) => void
  signal?: AbortSignal
}): Promise<number> {
  const write = opts.write ?? ((s) => process.stdout.write(s))
  const info = discoverService()
  if (!info) {
    console.error("no running nexus service; start one with `nexus serve` or `nexus service start`")
    return 1
  }
  const client = new NexusClient({ url: info.url, token: info.password })
  const session = (await client.createSession({
    cwd: opts.cwd,
    ...(opts.model ? { model: opts.model } : {}),
  })) as { id: string }
  await client.prompt(session.id, {
    text: opts.task,
    autoApprove: opts.yes,
  })
  let code = 0
  for await (const event of client.events({ sessionID: session.id, signal: opts.signal })) {
    code = applyEvent(event, opts.format, write, code)
    if (terminal(event.type)) break
  }
  return code
}

function terminal(type: string): boolean {
  return type === "runComplete" || type === "error" || type === "aborted" || type === "stepLimit"
}

function applyEvent(
  event: WireEvent,
  format: "text" | "ndjson",
  write: (s: string) => void,
  code: number,
): number {
  if (format === "ndjson") write(`${JSON.stringify(event)}\n`)
  else if (event.type === "tokenDelta" && typeof event.data.delta === "string") write(event.data.delta)
  if (event.type === "error") {
    if (format === "text") write(`\nerror: ${String(event.data.message ?? "")}\n`)
    return 1
  }
  if (event.type === "aborted") return 2
  if (event.type === "stepLimit") {
    if (format === "text") write(`\nstep limit reached (${String(event.data.steps ?? "")} steps); session marked limit\n`)
    return 3
  }
  return code
}
