import { expect, test } from "bun:test"
import { parseRetryAfter, requestSignal } from "./retry"

test("numeric Retry-After is delta-seconds, not a date", () => {
  expect(parseRetryAfter("5")).toBe(5_000)
  expect(parseRetryAfter("0")).toBe(0)
})

test("HTTP-date Retry-After returns the future delta", () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z")
  expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:10 GMT", now)).toBe(10_000)
})

test("invalid or missing Retry-After falls back to backoff", () => {
  expect(parseRetryAfter(null)).toBeUndefined()
  expect(parseRetryAfter("not-a-date")).toBeUndefined()
})

test("timeouts stay distinct from caller aborts", async () => {
  const timedOut = requestSignal(undefined, 5)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(timedOut?.aborted).toBe(true)
  expect((timedOut?.reason as DOMException).name).toBe("TimeoutError")

  const controller = new AbortController()
  const aborted = requestSignal(controller.signal, 60_000)
  controller.abort()
  expect((aborted?.reason as DOMException).name).toBe("AbortError")
})
