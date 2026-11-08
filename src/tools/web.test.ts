import { expect, test } from "bun:test"
import { htmlToText, parseDuckDuckGo, webfetch, websearch } from "./web"

test("htmlToText strips markup and scripts", () => {
  expect(htmlToText("<h1>Title</h1><script>bad()</script><p>Hello&nbsp;&amp; bye</p>")).toBe("Title\nHello & bye")
})

test("parseDuckDuckGo extracts results and snippets", () => {
  const html = `
    <a class="result__a" href="https://example.com/a">Example A</a>
    <a class="result__snippet">First result</a>
    <a class="result__a" href="https://example.com/b">Example B</a>
    <a class="result__snippet">Second result</a>`
  expect(parseDuckDuckGo(html)).toEqual([
    { title: "Example A", url: "https://example.com/a", description: "First result" },
    { title: "Example B", url: "https://example.com/b", description: "Second result" },
  ])
})

test("webfetch converts HTML responses", async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response("<html><body><p>Fetched</p><script>bad()</script></body></html>", {
      headers: { "content-type": "text/html" },
    })) as unknown as typeof fetch
  try {
    const result = await webfetch.execute({ url: "https://example.com" }, { cwd: process.cwd() })
    expect(result).toMatchObject({ ok: true, output: "Fetched" })
  } finally {
    globalThis.fetch = original
  }
})

test("websearch falls back to DuckDuckGo HTML", async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.BRAVE_SEARCH_API_KEY
  delete process.env.BRAVE_SEARCH_API_KEY
  globalThis.fetch = (async () =>
    new Response(
      '<a class="result__a" href="https://example.com/doc">Docs</a><a class="result__snippet">Reference</a>',
    )) as unknown as typeof fetch
  try {
    const result = await websearch.execute({ query: "docs" }, { cwd: process.cwd() })
    expect(result.ok).toBe(true)
    expect(result.output).toContain("https://example.com/doc")
    expect(result.output).toContain("Reference")
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey) process.env.BRAVE_SEARCH_API_KEY = originalKey
  }
})
