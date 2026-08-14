import { Box, Text } from "ink"
import type { StreamBlock } from "./present"
import type { Theme } from "./theme"

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

function Block({ block, t, caret }: { block: StreamBlock; t: Theme; caret?: boolean }) {
  switch (block.kind) {
    case "splash":
      return (
        <Box flexDirection="column" paddingLeft={1}>
          <Text color={t.gold} bold>
            Nexus
          </Text>
          <Text color={t.boneDim}>BYOK coding agent</Text>
        </Box>
      )
    case "user":
      return (
        <Box
          borderStyle="single"
          borderColor={t.gold}
          borderTop={false}
          borderRight={false}
          borderBottom={false}
          paddingLeft={1}
        >
          <Text>
            <Text color={t.gold}>you</Text>
            <Text color={t.bone}>  {block.text}</Text>
          </Text>
        </Box>
      )
    case "assistant":
      return <Rich text={block.text} color={t.bone} t={t} />
    case "fence":
      return (
        <Box paddingLeft={2}>
          <Text color={t.steel}>{block.text}</Text>
        </Box>
      )
    case "tool-call":
      return (
        <Text color={t.steel}>
          ▶ {block.name} {block.input}
        </Text>
      )
    case "tool-result": {
      const tag = block.ok ? "ok" : "error"
      const extra = block.error ? ` [${block.error}]` : ""
      return (
        <Text color={block.ok ? t.steel : t.crimson}>
          {"  "}
          {tag} {block.preview}
          {extra}
        </Text>
      )
    }
    case "live-line":
      return <Text color={t.steel}>{block.text}</Text>
    case "live-assistant":
      return (
        <Text>
          <Rich text={block.text} color={t.bone} t={t} />
          {caret ? <Text color={t.gold}>█</Text> : null}
        </Text>
      )
    case "log":
      return <Text color={t.boneDim}>{block.text}</Text>
    case "error":
      return <Text color={t.crimson}>error: {block.text}</Text>
    case "aborted":
      return <Text color={t.gold}>aborted</Text>
  }
}

export function Stream({
  blocks,
  height,
  busy,
  t,
}: {
  blocks: StreamBlock[]
  height: number
  busy: boolean
  t: Theme
}) {
  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      {blocks.map((b, i) => (
        <Block key={`${b.kind}-${i}`} block={b} t={t} caret={busy && b.kind === "live-assistant"} />
      ))}
    </Box>
  )
}
