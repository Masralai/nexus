export interface SSEEvent {
  event?: string
  data: string
}

export async function* readSSE(body: ReadableStream<Uint8Array> | null): AsyncIterable<SSEEvent> {
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let currentEvent: string | undefined
  let dataLines: string[] = []

  const flush = function* (): Iterable<SSEEvent> {
    if (dataLines.length > 0) {
      const data = dataLines.join("\n")
      dataLines = []
      const ev = currentEvent
      currentEvent = undefined
      if (data !== "" || ev !== undefined) yield { event: ev, data }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split("\n")
    buffer = parts.pop() ?? ""
    for (let raw of parts) {
      if (raw.endsWith("\r")) raw = raw.slice(0, -1)
      if (raw === "") {
        for (const e of flush()) yield e
        continue
      }
      if (raw.startsWith(":")) continue
      if (raw.startsWith("event:")) {
        currentEvent = raw.slice(6).trim()
      } else if (raw.startsWith("data:")) {
        let data = raw.slice(5)
        if (data.startsWith(" ")) data = data.slice(1)
        dataLines.push(data)
      } else if (raw === "data") {
        dataLines.push("")
      }
    }
  }
  // flush any remaining buffered lines (handle tail without trailing newline)
  if (buffer) {
    let raw = buffer
    if (raw.endsWith("\r")) raw = raw.slice(0, -1)
    if (raw !== "" && !raw.startsWith(":")) {
      if (raw.startsWith("event:")) currentEvent = raw.slice(6).trim()
      else if (raw.startsWith("data:")) {
        let data = raw.slice(5)
        if (data.startsWith(" ")) data = data.slice(1)
        dataLines.push(data)
      } else if (raw === "data") dataLines.push("")
    }
  }
  for (const e of flush()) yield e
  // also emit any leftover decoder bytes
  const tail = decoder.decode()
  if (tail) {
    for (const e of flush()) yield e
  }
}