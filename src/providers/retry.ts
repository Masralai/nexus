/** Combine a caller abort signal with a per-request timeout signal. */
export function requestSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): AbortSignal | undefined {
  if (!timeoutMs || timeoutMs <= 0) return signal
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, ms))
    return
  }
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException("aborted", "AbortError"))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

/** Parse Retry-After as delta-seconds first, then as an HTTP date. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const at = Date.parse(trimmed)
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined
}

/**
 * Bounded retry with jitter and retry-after support.
 * Callers must only use this for idempotent requests (streams are GET-like POSTs
 * with no server-side mutation, so retrying after a failed connect is safe).
 */
export async function fetchWithRetry(
  fetchImpl: typeof fetch,
  label: string,
  url: string,
  init: RequestInit,
  retryable: readonly number[],
): Promise<Response> {
  const maxRetries = 2
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    init.signal?.throwIfAborted()
    const res = await fetchImpl(url, init)
    if (res.ok) return res
    if (!retryable.includes(res.status) || attempt === maxRetries) {
      throw new Error(`${label}: HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`)
    }
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"))
    const delayMs = retryAfter ?? 500 * Math.pow(2, attempt) + Math.random() * 250
    await sleep(Math.min(delayMs, 5_000), init.signal ?? undefined)
  }
  throw new Error(`${label}: retry exhausted`)
}
