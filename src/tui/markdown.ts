// Pure markdown helpers for Stream viewport presentation seam.
// Used by present.ts linesOf and stream.tsx Row rendering.
// Only assistant / live-assistant blocks use this; other blocks stay literal.

export type SegmentKind = "text" | "bold" | "code" | "italic" | "linkUrl"
export interface Segment {
  kind: SegmentKind
  text: string
}

export function stripHtml(text: string): string {
  // Preserve autolinks like <https://example.com> — do not strip them
  return text.replace(/<[^>]*>/g, (m) => {
    if (/^<https?:\/\/[^>]+>$/.test(m)) return m
    return ""
  })
}

// Inline parsing: handle [label](url), autolink <https://...>, **bold**, `code`, *italic*, _italic_
// Order: link -> autolink -> code -> bold -> italic (single star / underscore)
// Markers without closing are left as plain.
export function parseInline(text: string): Segment[] {
  const segs: Segment[] = []
  const re = /(\[[^\]]+\]\([^)]+\)|<https?:\/\/[^>]+>|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g
  let last = 0
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0
    if (idx > last) segs.push({ kind: "text", text: text.slice(last, idx) })
    const raw = m[0]
    if (raw.startsWith("[")) {
      // link: [label](url)
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(raw)
      if (lm) {
        const label = lm[1] ?? ""
        const url = lm[2] ?? ""
        if (label) segs.push({ kind: "text", text: label })
        if (url) {
          if (label) segs.push({ kind: "text", text: " " })
          segs.push({ kind: "linkUrl", text: `(${url})` })
        }
      } else {
        segs.push({ kind: "text", text: raw })
      }
    } else if (raw.startsWith("<http")) {
      const url = raw.slice(1, -1)
      segs.push({ kind: "linkUrl", text: url })
    } else if (raw.startsWith("**")) {
      segs.push({ kind: "bold", text: raw.slice(2, -2) })
    } else if (raw.startsWith("`")) {
      segs.push({ kind: "code", text: raw.slice(1, -1) })
    } else if (raw.startsWith("*") || raw.startsWith("_")) {
      // single italic
      const inner = raw.slice(1, -1)
      segs.push({ kind: "italic", text: inner })
    } else {
      segs.push({ kind: "text", text: raw })
    }
    last = idx + raw.length
  }
  if (last < text.length) segs.push({ kind: "text", text: text.slice(last) })
  if (segs.length === 0) segs.push({ kind: "text", text })
  return segs
}

export function renderInlinePlain(text: string): string {
  const stripped = stripHtml(text)
  const segs = parseInline(stripped)
  // For links we already expanded to "label (url)" via parseInline; plain is concatenation.
  // For other segments, just concatenate text.
  return segs.map((s) => s.text).join("")
}

// Block helpers
function isThematicBreak(trimmed: string): boolean {
  return /^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)
}

function parseHeading(trimmed: string): string | null {
  const m = /^(#{1,6})\s+(.*)$/.exec(trimmed)
  if (!m) return null
  return m[2] ?? ""
}

function parseUnorderedList(line: string): { indentLevel: number; content: string } | null {
  const m = /^(\s*)([*+-])\s+(.*)$/.exec(line)
  if (!m) return null
  const leading = m[1] ?? ""
  const content = m[3] ?? ""
  const indentLevel = Math.floor(leading.length / 2)
  return { indentLevel, content }
}

function parseOrderedList(line: string): { indentLevel: number; number: string; content: string } | null {
  const m = /^(\s*)(\d+)\.\s+(.*)$/.exec(line)
  if (!m) return null
  const leading = m[1] ?? ""
  const num = m[2] ?? ""
  const content = m[3] ?? ""
  const indentLevel = Math.floor(leading.length / 2)
  return { indentLevel, number: num, content }
}

function parseBlockquote(trimmed: string): string | null {
  const m = /^>\s?(.*)$/.exec(trimmed)
  if (!m) return null
  return m[1] ?? ""
}

function wrapLogical(prefix: string, body: string, cols: number): string[] {
  const w = Math.max(1, cols)
  const prefixLen = prefix.length
  const indent = " ".repeat(prefixLen)
  // body is already plain (markers stripped)
  if (body === "" && prefix === "") return [""]
  // For rule, body is empty and prefix is rule line itself
  if (prefix !== "" && body === "") {
    // rule case where prefix holds the whole line
    return wrapSimple(prefix, w)
  }
  const logical = prefix + body
  if (logical.length <= w) return [logical]
  // Need to wrap body portion with word-aware breaking
  const out: string[] = []
  let bodyPos = 0
  const prefixStr = prefix
  let first = true
  while (bodyPos < body.length) {
    const avail = first ? w - prefixStr.length : w - indent.length
    const remaining = body.length - bodyPos
    let take = Math.min(avail, remaining)
    let chunk = body.slice(bodyPos, bodyPos + take)
    // If we are not at end, try to break at last space within window
    if (bodyPos + take < body.length) {
      // Look ahead one char to decide word boundary
      const windowSlice = body.slice(bodyPos, bodyPos + take + 1)
      const lastSpace = windowSlice.lastIndexOf(" ")
      // Only break at space if there is a space and the break point is not at start
      // and previous chunk not already ending with space
      if (lastSpace > 0 && lastSpace < windowSlice.length - 1) {
        // take up to lastSpace
        take = lastSpace
        chunk = body.slice(bodyPos, bodyPos + take)
      } else if (lastSpace === windowSlice.length - 1) {
        // space at boundary, include up to space-1
        // keep take as is but will trim
      }
      // If no space found, hard slice at avail
    }
    chunk = chunk.trimEnd()
    // If chunk empty due to multiple spaces, advance
    if (chunk.length === 0) {
      bodyPos += take
      while (body[bodyPos] === " ") bodyPos++
      continue
    }
    out.push(first ? prefixStr + chunk : indent + chunk)
    bodyPos += take
    // skip spaces between chunks
    while (body[bodyPos] === " ") bodyPos++
    // After first, consume any leading spaces already skipped
    first = false
    if (bodyPos >= body.length) break
    // If chunk was trimmed, we already accounted
  }
  // If body was empty but prefix exists (should not happen)
  if (out.length === 0) out.push(logical)
  return out
}

function wrapSimple(text: string, w: number): string[] {
  const lines: string[] = []
  for (const para of text.split("\n")) {
    if (para.length === 0) {
      lines.push("")
      continue
    }
    for (let i = 0; i < para.length; i += w) lines.push(para.slice(i, i + w))
  }
  return lines.length > 0 ? lines : [""]
}

export function assistantPlainLines(text: string, cols: number): string[] {
  return assistantStyledRows(text, cols).map((r) => r.plain)
}

// Styled variant for stream.tsx — returns per visual row segments with metadata
export interface StyledRow {
  plain: string
  segments: Segment[]
  isHeading: boolean
  isRule: boolean
  isQuote: boolean
}

function sliceSegments(segments: Segment[], start: number, end: number): Segment[] {
  // slice plain concatenation [start,end) in terms of characters
  const out: Segment[] = []
  let pos = 0
  for (const seg of segments) {
    const len = seg.text.length
    const segStart = pos
    const segEnd = pos + len
    if (segEnd <= start || segStart >= end) {
      // no overlap
    } else {
      const from = Math.max(0, start - segStart)
      const to = Math.min(len, end - segStart)
      const slice = seg.text.slice(from, to)
      if (slice) out.push({ kind: seg.kind, text: slice })
    }
    pos += len
    if (pos >= end) break
  }
  return out
}

export function assistantStyledRows(text: string, cols: number): StyledRow[] {
  const w = Math.max(1, cols)
  const stripped = stripHtml(text)
  const rawLines = stripped.split("\n")
  const rows: StyledRow[] = []
  for (const raw of rawLines) {
    const trimmed = raw.trim()
    if (trimmed === "") {
      rows.push({ plain: "", segments: [{ kind: "text", text: "" }], isHeading: false, isRule: false, isQuote: false })
      continue
    }
    if (isThematicBreak(trimmed)) {
      const rule = "─".repeat(Math.min(30, w))
      const wrapped = wrapSimple(rule, w)
      for (const p of wrapped) rows.push({ plain: p, segments: [{ kind: "text", text: p }], isHeading: false, isRule: true, isQuote: false })
      continue
    }
    const headingContent = parseHeading(trimmed)
    if (headingContent !== null) {
      const body = headingContent
      const bodySegs = parseInline(body)
      // plain for heading is renderInlinePlain(body)
      const plainBody = bodySegs.map((s) => s.text).join("")
      // Heading is rendered bold overall; convert all segments to bold for styling (preserve code?)
      // Keep code as code, others as bold
      const headingSegs: Segment[] = bodySegs.map((s) => (s.kind === "code" ? s : { kind: "bold" as const, text: s.text }))
      const wrapped = wrapLogical("", plainBody, w)
      // Need to slice headingSegs per wrapped row
      let pos = 0
      for (const wp of wrapped) {
        // wp is plainBody slice with possible word wrap; slice segs accordingly
        const segs = sliceSegments(headingSegs, pos, pos + wp.length)
        rows.push({ plain: wp, segments: segs.length ? segs : [{ kind: "bold", text: wp }], isHeading: true, isRule: false, isQuote: false })
        pos += wp.length
        // Adjust pos for spaces skipped in wrapLogical: our wrapLogical skips spaces, so plainBody pos tracking with wp length + skipped spaces not exact.
        // For simplicity, advance pos by wp.length plus one space if not at end and plainBody[pos] is space.
        while (plainBody[pos] === " ") pos++
      }
      continue
    }
    const bq = parseBlockquote(trimmed)
    if (bq !== null) {
      const bodySegs = parseInline(bq)
      const plainBody = bodySegs.map((s) => s.text).join("")
      const prefix = "▎ "
      const wrapped = wrapLogical(prefix, plainBody, w)
      // For styled, prefix as text segment
      let pos = 0
      for (let i = 0; i < wrapped.length; i++) {
        const wp = wrapped[i]!
        const isFirst = i === 0
        const prefixLen = prefix.length
        const indent = " ".repeat(prefixLen)
        if (isFirst) {
          // wp = prefix + chunk
          const chunk = wp.slice(prefixLen)
          const chunkSegs = sliceSegments(bodySegs, pos, pos + chunk.length)
          const segs: Segment[] = [{ kind: "text", text: prefix }, ...chunkSegs]
          rows.push({ plain: wp, segments: segs, isHeading: false, isRule: false, isQuote: true })
          pos += chunk.length
          while (plainBody[pos] === " ") pos++
        } else {
          const chunk = wp.slice(indent.length)
          const chunkSegs = sliceSegments(bodySegs, pos, pos + chunk.length)
          const segs: Segment[] = [{ kind: "text", text: indent }, ...chunkSegs]
          rows.push({ plain: wp, segments: segs, isHeading: false, isRule: false, isQuote: true })
          pos += chunk.length
          while (plainBody[pos] === " ") pos++
        }
      }
      continue
    }
    const ol = parseOrderedList(raw)
    if (ol) {
      const indentStr = "  ".repeat(ol.indentLevel)
      const prefix = `${indentStr}${ol.number}. `
      const bodySegs = parseInline(ol.content)
      const plainBody = bodySegs.map((s) => s.text).join("")
      const wrapped = wrapLogical(prefix, plainBody, w)
      let pos = 0
      for (let i = 0; i < wrapped.length; i++) {
        const wp = wrapped[i]!
        const isFirst = i === 0
        if (isFirst) {
          const chunk = wp.slice(prefix.length)
          const chunkSegs = sliceSegments(bodySegs, pos, pos + chunk.length)
          rows.push({ plain: wp, segments: [{ kind: "text", text: prefix }, ...chunkSegs], isHeading: false, isRule: false, isQuote: false })
          pos += chunk.length
          while (plainBody[pos] === " ") pos++
        } else {
          const indent = " ".repeat(prefix.length)
          const chunk = wp.slice(indent.length)
          const chunkSegs = sliceSegments(bodySegs, pos, pos + chunk.length)
          rows.push({ plain: wp, segments: [{ kind: "text", text: indent }, ...chunkSegs], isHeading: false, isRule: false, isQuote: false })
          pos += chunk.length
          while (plainBody[pos] === " ") pos++
        }
      }
      continue
    }
    const ul = parseUnorderedList(raw)
    if (ul) {
      const indentStr = "  ".repeat(ul.indentLevel)
      const prefix = `${indentStr}• `
      const bodySegs = parseInline(ul.content)
      const plainBody = bodySegs.map((s) => s.text).join("")
      const wrapped = wrapLogical(prefix, plainBody, w)
      let pos = 0
      for (let i = 0; i < wrapped.length; i++) {
        const wp = wrapped[i]!
        const isFirst = i === 0
        if (isFirst) {
          const chunk = wp.slice(prefix.length)
          const chunkSegs = sliceSegments(bodySegs, pos, pos + chunk.length)
          rows.push({ plain: wp, segments: [{ kind: "text", text: prefix }, ...chunkSegs], isHeading: false, isRule: false, isQuote: false })
          pos += chunk.length
          while (plainBody[pos] === " ") pos++
        } else {
          const indent = " ".repeat(prefix.length)
          const chunk = wp.slice(indent.length)
          const chunkSegs = sliceSegments(bodySegs, pos, pos + chunk.length)
          rows.push({ plain: wp, segments: [{ kind: "text", text: indent }, ...chunkSegs], isHeading: false, isRule: false, isQuote: false })
          pos += chunk.length
          while (plainBody[pos] === " ") pos++
        }
      }
      continue
    }
    // paragraph
    const bodySegs = parseInline(raw.trim())
    const plainBody = bodySegs.map((s) => s.text).join("")
    const wrapped = wrapLogical("", plainBody, w)
    let pos = 0
    for (const wp of wrapped) {
      const chunk = wp
      const chunkSegs = sliceSegments(bodySegs, pos, pos + chunk.length)
      // account for spaces skipped
      const segs: Segment[] = chunkSegs.length ? chunkSegs : [{ kind: "text" as const, text: wp }]
      rows.push({ plain: wp, segments: segs, isHeading: false, isRule: false, isQuote: false })
      pos += chunk.length
      while (plainBody[pos] === " ") pos++
    }
  }
  if (rows.length === 0 && stripped.length > 0) {
    const segs = parseInline(stripped)
    rows.push({ plain: segs.map((s) => s.text).join(""), segments: segs, isHeading: false, isRule: false, isQuote: false })
  }
  return rows
}
