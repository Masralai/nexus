export interface SSEEvent {
  event?: string
  data: string
}

export async function* readSSE(body: ReadableStream<Uint8Array> | null): AsyncIterable<SSEEvent> {
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let lastEvent: string | undefined
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (line.startsWith("event:")) lastEvent = line.slice(6).trim()
      else if (line.startsWith("data:")) {
        const data = line.startsWith("data: ") ? line.slice(6) : line.slice(5)
        if (data) {
          yield { event: lastEvent, data }
          lastEvent = undefined
        }
      }
    }
  }
  const tail = buffer
  if (tail.startsWith("data:")) {
    const data = tail.startsWith("data: ") ? tail.slice(6) : tail.slice(5)
    if (data) yield { event: lastEvent, data }
  }
}