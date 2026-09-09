import { Box, Text } from "ink"
import { linesOf, type StreamBlock, type ScreenRow } from "./present"
import type { Theme } from "./theme"
import type { SelectionAnchor } from "./present"
import { assistantStyledRows, type Segment } from "./markdown"

function renderSegments(
  segments: Segment[],
  defaultColor: string,
  t: Theme,
  isHeading: boolean,
  isRule: boolean,
  isQuote: boolean,
) {
  return segments.map((seg, i) => {
    if (seg.kind === "bold") {
      return (
        <Text key={i} bold color={isQuote ? t.boneDim : defaultColor}>
          {seg.text}
        </Text>
      )
    }
    if (seg.kind === "code") {
      return (
        <Text key={i} color={t.steel}>
          {seg.text}
        </Text>
      )
    }
    if (seg.kind === "italic") {
      return (
        <Text key={i} dimColor color={defaultColor}>
          {seg.text}
        </Text>
      )
    }
    if (seg.kind === "linkUrl") {
      return (
        <Text key={i} color={t.boneDim}>
          {seg.text}
        </Text>
      )
    }
    // text
    if (isRule) return (
      <Text key={i} color={t.boneDim}>
        {seg.text}
      </Text>
    )
    if (isQuote) return (
      <Text key={i} color={t.boneDim}>
        {seg.text}
      </Text>
    )
    if (isHeading) {
      return (
        <Text key={i} bold color={defaultColor}>
          {seg.text}
        </Text>
      )
    }
    return <Text key={i}>{seg.text}</Text>
  })
}

function renderSegmentsWithSelection(
  segments: Segment[],
  selStart: number | undefined,
  selEnd: number | undefined,
  defaultColor: string,
  t: Theme,
  isHeading: boolean,
  isRule: boolean,
  isQuote: boolean,
) {
  const hasSel = selStart !== undefined && selEnd !== undefined && selEnd > selStart
  if (!hasSel) {
    return <Text color={defaultColor}>{renderSegments(segments, defaultColor, t, isHeading, isRule, isQuote)}</Text>
  }
  let pos = 0
  const nodes: React.ReactNode[] = []
  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx]!
    const len = seg.text.length
    const segStart = pos
    const segEnd = pos + len
    if (segEnd <= selStart || segStart >= selEnd) {
      // no overlap
      if (seg.kind === "bold") nodes.push(<Text key={`${idx}-n`} bold color={isQuote ? t.boneDim : defaultColor}>{seg.text}</Text>)
      else if (seg.kind === "code") nodes.push(<Text key={`${idx}-n`} color={t.steel}>{seg.text}</Text>)
      else if (seg.kind === "italic") nodes.push(<Text key={`${idx}-n`} dimColor color={defaultColor}>{seg.text}</Text>)
      else if (seg.kind === "linkUrl") nodes.push(<Text key={`${idx}-n`} color={t.boneDim}>{seg.text}</Text>)
      else {
        const c = isRule || isQuote ? t.boneDim : defaultColor
        const bold = isHeading
        nodes.push(bold ? <Text key={`${idx}-n`} bold color={c}>{seg.text}</Text> : <Text key={`${idx}-n`} color={c}>{seg.text}</Text>)
      }
    } else {
      const beforeLen = Math.max(0, selStart - segStart)
      const selLen = Math.min(segEnd, selEnd) - Math.max(segStart, selStart)
      const afterLen = len - beforeLen - selLen
      const before = beforeLen > 0 ? seg.text.slice(0, beforeLen) : ""
      const sel = seg.text.slice(beforeLen, beforeLen + selLen)
      const after = afterLen > 0 ? seg.text.slice(beforeLen + selLen) : ""
      if (before) {
        if (seg.kind === "bold") nodes.push(<Text key={`${idx}-b`} bold color={isQuote ? t.boneDim : defaultColor}>{before}</Text>)
        else if (seg.kind === "code") nodes.push(<Text key={`${idx}-b`} color={t.steel}>{before}</Text>)
        else if (seg.kind === "italic") nodes.push(<Text key={`${idx}-b`} dimColor color={defaultColor}>{before}</Text>)
        else if (seg.kind === "linkUrl") nodes.push(<Text key={`${idx}-b`} color={t.boneDim}>{before}</Text>)
        else {
          const c = isRule || isQuote ? t.boneDim : defaultColor
          nodes.push(isHeading ? <Text key={`${idx}-b`} bold color={c}>{before}</Text> : <Text key={`${idx}-b`} color={c}>{before}</Text>)
        }
      }
      if (sel) {
        // selected piece: inverse, preserve original style plus inverse
        if (seg.kind === "bold") nodes.push(<Text key={`${idx}-s`} bold inverse color={isQuote ? t.boneDim : defaultColor}>{sel}</Text>)
        else if (seg.kind === "code") nodes.push(<Text key={`${idx}-s`} color={t.steel} inverse>{sel}</Text>)
        else if (seg.kind === "italic") nodes.push(<Text key={`${idx}-s`} dimColor inverse color={defaultColor}>{sel}</Text>)
        else if (seg.kind === "linkUrl") nodes.push(<Text key={`${idx}-s`} color={t.boneDim} inverse>{sel}</Text>)
        else {
          const c = isRule || isQuote ? t.boneDim : defaultColor
          nodes.push(isHeading ? <Text key={`${idx}-s`} bold inverse color={c}>{sel}</Text> : <Text key={`${idx}-s`} inverse color={c}>{sel}</Text>)
        }
      }
      if (after) {
        if (seg.kind === "bold") nodes.push(<Text key={`${idx}-a`} bold color={isQuote ? t.boneDim : defaultColor}>{after}</Text>)
        else if (seg.kind === "code") nodes.push(<Text key={`${idx}-a`} color={t.steel}>{after}</Text>)
        else if (seg.kind === "italic") nodes.push(<Text key={`${idx}-a`} dimColor color={defaultColor}>{after}</Text>)
        else if (seg.kind === "linkUrl") nodes.push(<Text key={`${idx}-a`} color={t.boneDim}>{after}</Text>)
        else {
          const c = isRule || isQuote ? t.boneDim : defaultColor
          nodes.push(isHeading ? <Text key={`${idx}-a`} bold color={c}>{after}</Text> : <Text key={`${idx}-a`} color={c}>{after}</Text>)
        }
      }
    }
    pos += len
  }
  return <Text color={defaultColor}>{nodes}</Text>
}

function Row({
  block,
  line,
  segments,
  isHeading,
  isRule,
  isQuote,
  t,
  caret,
  selectionStart,
  selectionEnd,
}: {
  block: StreamBlock
  line: string
  segments?: Segment[]
  isHeading?: boolean
  isRule?: boolean
  isQuote?: boolean
  t: Theme
  caret?: boolean
  selectionStart?: number
  selectionEnd?: number
}) {
  const hasSelection = selectionStart !== undefined && selectionEnd !== undefined && selectionEnd > selectionStart

  function renderWithSelection(text: string, color: string) {
    if (!hasSelection) return <Text color={color}>{text}</Text>
    const before = text.slice(0, selectionStart!)
    const selected = text.slice(selectionStart!, selectionEnd!)
    const after = text.slice(selectionEnd!)
    return (
      <Text color={color}>
        {before && <Text>{before}</Text>}
        {selected && <Text inverse>{selected}</Text>}
        {after && <Text>{after}</Text>}
      </Text>
    )
  }

  switch (block.kind) {
    case "splash":
      return line === "Nexus" ? (
        <Text color={t.gold} bold>
          {" "}
          {line}
        </Text>
      ) : (
        <Text color={t.boneDim}> {line}</Text>
      )
    case "user":
      return (
        <Text>
          <Text color={t.gold}> you </Text>
          {renderWithSelection(line, t.bone)}
        </Text>
      )
    case "assistant":
    case "live-assistant": {
      if (segments && segments.length > 0) {
        return (
          <Text>
            {renderSegmentsWithSelection(segments, selectionStart, selectionEnd, t.bone, t, !!isHeading, !!isRule, !!isQuote)}
            {caret ? <Text color={t.gold}>█</Text> : null}
          </Text>
        )
      }
      return (
        <Text>
          {renderWithSelection(line, t.bone)}
          {caret ? <Text color={t.gold}>█</Text> : null}
        </Text>
      )
    }
    case "fence":
      return (
        <Box paddingLeft={2}>
          {renderWithSelection(line, t.steel)}
        </Box>
      )
    case "tool-call":
    case "live-line":
      return <Text color={t.steel}>{line}</Text>
    case "tool-result":
      return <Text color={block.ok ? t.steel : t.crimson}>{line}</Text>
    case "log":
      return <Text color={t.boneDim}>{line}</Text>
    case "error":
      return <Text color={t.crimson}>error: {line}</Text>
    case "aborted":
      return <Text color={t.gold}>{line}</Text>
  }
}

export function Stream({
  blocks,
  height,
  busy,
  t,
  cols,
  anchor,
  active,
}: {
  blocks: StreamBlock[]
  height: number
  busy: boolean
  t: Theme
  cols: number
  anchor?: SelectionAnchor
  active?: SelectionAnchor
}) {
  // Build visual rows: for assistant blocks use styled rows so segments stay in sync with plain lines
  const rows: Array<{ block: StreamBlock; line: string; segments?: Segment[]; isHeading?: boolean; isRule?: boolean; isQuote?: boolean }> = []
  for (const block of blocks) {
    if (block.kind === "assistant" || block.kind === "live-assistant") {
      const styled = assistantStyledRows(block.text, cols)
      for (const sr of styled) rows.push({ block, line: sr.plain, segments: sr.segments, isHeading: sr.isHeading, isRule: sr.isRule, isQuote: sr.isQuote })
    } else {
      for (const line of linesOf(block, cols)) rows.push({ block, line })
    }
  }
  const last = rows.length - 1

  // Compute selection column range per screen row
  const hasSel = anchor && active
  const selR0 = hasSel ? Math.min(anchor!.row, active!.row) : -1
  const selR1 = hasSel ? Math.max(anchor!.row, active!.row) : -1

  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      {rows.map((r, i) => {
        let selStart: number | undefined
        let selEnd: number | undefined

        if (hasSel && i >= selR0 && i <= selR1) {
          const lineLen = r.line.length
          if (selR0 === selR1) {
            selStart = Math.min(anchor!.col, active!.col)
            selEnd = Math.max(anchor!.col, active!.col)
          } else if (i === selR0) {
            selStart = anchor!.row === selR0 ? anchor!.col : active!.col
            selEnd = lineLen
          } else if (i === selR1) {
            selStart = 0
            selEnd = active!.row === selR1 ? active!.col : anchor!.col
          } else {
            selStart = 0
            selEnd = lineLen
          }
          selStart = Math.max(0, Math.min(lineLen, selStart))
          selEnd = Math.max(0, Math.min(lineLen, selEnd))
          if (selEnd <= selStart) {
            selStart = undefined
            selEnd = undefined
          }
        }

        return (
          <Row
            key={`${r.block.kind}-${i}`}
            block={r.block}
            line={r.line}
            segments={r.segments}
            isHeading={r.isHeading}
            isRule={r.isRule}
            isQuote={r.isQuote}
            t={t}
            caret={busy && r.block.kind === "live-assistant" && i === last}
            selectionStart={selStart}
            selectionEnd={selEnd}
          />
        )
      })}
    </Box>
  )
}
