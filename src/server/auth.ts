import { timingSafeEqual } from "node:crypto"

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function bearer(req: Request): string | undefined {
  const header = req.headers.get("authorization")
  if (!header) return undefined
  const [scheme, ...rest] = header.trim().split(/\s+/)
  if (scheme?.toLowerCase() !== "bearer") return undefined
  const token = rest.join(" ")
  return token || undefined
}

function basic(req: Request): string | undefined {
  const header = req.headers.get("authorization")
  if (!header) return undefined
  const [scheme, encoded] = header.trim().split(/\s+/)
  if (scheme?.toLowerCase() !== "basic" || !encoded) return undefined
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8")
    const idx = decoded.indexOf(":")
    return idx >= 0 ? decoded.slice(idx + 1) : undefined
  } catch {
    return undefined
  }
}

/** Token from a bearer/basic header, the private header, or the SSE query parameter. */
export function requestToken(req: Request, url: URL): string | undefined {
  return (
    bearer(req) ??
    basic(req) ??
    req.headers.get("x-nexus-token") ??
    url.searchParams.get("token") ??
    undefined
  )
}

/** Empty server tokens disable auth; generated tokens are non-empty in normal use. */
export function authorized(req: Request, url: URL, token: string): boolean {
  if (!token) return true
  const supplied = requestToken(req, url)
  return Boolean(supplied && safeEqual(supplied, token))
}
