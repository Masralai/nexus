import { Box, Text } from "ink"
import { linesOf, type StreamBlock, type ScreenRow } from "./present"
import type { Theme } from "./theme"
import type { SelectionAnchor } from "./present"

function inlineParts(text: string): { kind: "text" | "bold" | "code"; text: string }[] {
  const parts: { kind: "text" | "bold" | "code"; text: string }[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push({ kind: "text", text: text.slice(last, m.index) })
    const raw = m[0]
    if (raw.startsWith("**")) parts.push({ kind: "bold", text: raw.slice(2, -2) })
    else parts.push({ kind: "code", text: raw.slice(1, -1) })
    last = m.index + raw.length
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) })
  if (parts.length === 0) parts.push({ kind: "text", text })
  return parts
}

function Rich({ text, color, t }: { text: string; color: string; t: Theme }) {
  return (
    <Text color={color}>
      {inlineParts(text).map((p, i) =>
        p.kind === "bold" ? (
          <Text key={i} bold>
            {p.text}
          </Text>
        ) : p.kind === "code" ? (
          <Text key={i} color={t.steel}>
            {p.text}
          </Text>
        ) : (
          <Text key={i}>{p.text}</Text>
        ),
      )}
    </Text>
  )
}

function Row({
  block,
  line,
  t,
  caret,
  selectionStart,
  selectionEnd,
}: {
  block: StreamBlock
  line: string
  t: Theme
  caret?: boolean
  selectionStart?: number
  selectionEnd?: number
}) {
  const hasSelection = selectionStart !== undefined && selectionEnd !== undefined && selectionEnd > selectionStart

  function renderWithSelection(text: string, color: string) {
    if (!hasSelection) return <Text color={color}>{text}</Text>
    const before = text.slice(0, selectionStart)
    const selected = text.slice(selectionStart, selectionEnd)
    const after = text.slice(selectionEnd)
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
    case "live-assistant":
      return (
        <Text>
          {renderWithSelection(line, t.bone)}
          {caret ? <Text color={t.gold}>█</Text> : null}
        </Text>
      )
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
  const rows = blocks.flatMap((block) => linesOf(block, cols).map((line) => ({ block, line })))
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
