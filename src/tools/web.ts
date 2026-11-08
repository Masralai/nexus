import type { Tool } from "../engine/types"

const MAX_OUTPUT = 32_000
const MAX_SEARCH_RESULTS = 5

function cap(text: string): string {
  return text.length <= MAX_OUTPUT ? text : `${text.slice(0, MAX_OUTPUT)}\n[...truncated ${text.length - MAX_OUTPUT} chars]`
}

/** Strip scripts, styles, and tags. Keeps readable line breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|pre|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/^[ \t]+/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

export interface SearchResult {
  title: string
  url: string
  description?: string
}

/** Parse DuckDuckGo HTML results without a DOM dependency. */
export function parseDuckDuckGo(html: string, limit = MAX_SEARCH_RESULTS): SearchResult[] {
  const out: SearchResult[] = []
  const pattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippet = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
  const snippets: string[] = []
  for (const match of html.matchAll(snippet)) snippets.push(htmlToText(match[1]))
  for (const match of html.matchAll(pattern)) {
    if (out.length >= limit) break
    const url = decodeURIComponent(match[1].replace(/&amp;/g, "&"))
    const title = htmlToText(match[2])
    if (!url.startsWith("http") || !title) continue
    out.push({ title, url, ...(snippets[out.length] ? { description: snippets[out.length] } : {}) })
  }
  return out
}

async function searchBrave(query: string, count: number, signal: AbortSignal): Promise<SearchResult[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY
  if (!key) return []
  const url = new URL("https://api.search.brave.com/res/v1/web/search")
  url.searchParams.set("q", query)
  url.searchParams.set("count", String(count))
  const res = await fetch(url, {
    headers: { accept: "application/json", "x-subscription-token": key },
    signal,
  })
  if (!res.ok) throw new Error(`websearch: HTTP ${res.status}`)
  const body = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
  }
  return (body.web?.results ?? [])
    .filter((item): item is { title: string; url: string; description?: string } => Boolean(item.title && item.url))
    .slice(0, count)
    .map((item) => ({ title: item.title, url: item.url, ...(item.description ? { description: htmlToText(item.description) } : {}) }))
}

export const webfetch: Tool = {
  name: "webfetch",
  description:
    "Fetch a URL and return readable text. Input: { url, format?: 'text'|'html' }. Use for documentation and external references. HTML is stripped to text by default.",
  schema: {
    type: "object",
    properties: { url: { type: "string" }, format: { type: "string", enum: ["text", "html"] } },
    required: ["url"],
  },
  readonly: true,
  outputLimit: 32_000,
  async execute(input) {
    const { url, format } = (input ?? {}) as { url?: string; format?: string }
    if (!url) return { ok: false, output: "", error: "url is required" }
    let target: URL
    try {
      target = new URL(url)
    } catch {
      return { ok: false, output: "", error: `invalid url: ${url}` }
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return { ok: false, output: "", error: "only http and https urls are supported" }
    }
    try {
      const res = await fetch(target, {
        headers: { "user-agent": "nexus/0.1 (+https://github.com/Masralai/nexus)" },
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) return { ok: false, output: "", error: `HTTP ${res.status} ${res.statusText}` }
      const raw = await res.text()
      const type = res.headers.get("content-type") ?? ""
      const body = format === "html" || !type.includes("html") ? raw : htmlToText(raw)
      return { ok: true, output: cap(body) }
    } catch (error) {
      return { ok: false, output: "", error: error instanceof Error ? error.message : String(error) }
    }
  },
}

export const websearch: Tool = {
  name: "websearch",
  description:
    "Search the web. Input: { query, limit? }. Uses BRAVE_SEARCH_API_KEY when present, otherwise DuckDuckGo HTML. Returns titles, URLs, and snippets.",
  schema: {
    type: "object",
    properties: { query: { type: "string" }, limit: { type: "number" } },
    required: ["query"],
  },
  readonly: true,
  outputLimit: 8_000,
  async execute(input) {
    const { query, limit } = (input ?? {}) as { query?: string; limit?: number }
    if (!query?.trim()) return { ok: false, output: "", error: "query is required" }
    const count = Math.min(Math.max(1, Math.floor(limit ?? MAX_SEARCH_RESULTS)), 10)
    const signal = AbortSignal.timeout(20_000)
    try {
      let results = await searchBrave(query, count, signal)
      if (results.length === 0) {
        const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
          headers: { "user-agent": "Mozilla/5.0 (compatible; nexus/0.1)" },
          signal,
        })
        if (!res.ok) return { ok: false, output: "", error: `websearch: HTTP ${res.status}` }
        results = parseDuckDuckGo(await res.text(), count)
      }
      if (results.length === 0) return { ok: true, output: "no results" }
      return {
        ok: true,
        output: cap(
          results
            .map((result, index) => `${index + 1}. ${result.title}\n${result.url}${result.description ? `\n${result.description}` : ""}`)
            .join("\n\n"),
        ),
      }
    } catch (error) {
      return { ok: false, output: "", error: error instanceof Error ? error.message : String(error) }
    }
  },
}
