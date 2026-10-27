import type { WireEvent } from "./service"

const HEARTBEAT_MS = 15_000

export function sseFrame(event: WireEvent, includeID = true): string {
  const lines = [`event: ${event.type}`, `data: ${JSON.stringify(event)}`]
  if (includeID) lines.unshift(`id: ${event.cursor}`)
  return `${lines.join("\n")}\n\n`
}

export interface EventStreamOptions {
  initial: WireEvent[]
  follow: boolean
  signal: AbortSignal
  subscribe: (listener: (event: WireEvent) => void) => () => void
  sessionID?: string
  includeID?: boolean
}

/**
 * Replay runs synchronously before the live subscription is installed, so no
 * event can fall into the gap between backlog and follow mode.
 */
export function eventStream(options: EventStreamOptions): Response {
  const encoder = new TextEncoder()
  let cleanup = () => {}

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let unsubscribe: (() => void) | undefined
      let heartbeat: ReturnType<typeof setInterval> | undefined

      const close = () => {
        if (closed) return
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        unsubscribe?.()
        options.signal.removeEventListener("abort", close)
        try {
          controller.close()
        } catch {
          // Already closed by the client.
        }
      }
      cleanup = close

      const send = (event: WireEvent) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(sseFrame(event, options.includeID ?? true)))
        } catch {
          close()
        }
      }

      try {
        controller.enqueue(encoder.encode(": connected\n\n"))
      } catch {
        close()
        return
      }

      for (const event of options.initial) send(event)
      if (!options.follow) {
        close()
        return
      }

      unsubscribe = options.subscribe((event) => {
        if (options.sessionID && event.sessionID !== options.sessionID) return
        send(event)
      })
      heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(": ping\n\n"))
        } catch {
          close()
        }
      }, HEARTBEAT_MS)
      options.signal.addEventListener("abort", close, { once: true })
      if (options.signal.aborted) close()
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  })
}
