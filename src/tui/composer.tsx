import type { AgentMode } from "../engine/mode"
import { Box, Text } from "ink"
import { filterSlashCommands } from "./slash"
import type { Theme } from "./theme"

export function Composer({
  mode,
  value,
  cursor,
  busy,
  slashIdx,
  scrollable,
  t,
}: {
  mode: AgentMode
  value: string
  cursor: number
  busy: boolean
  slashIdx: number
  scrollable?: boolean
  t: Theme
}) {
  if (busy) {
    return (
      <Box>
        <Text color={t.boneDim}>running a Turn · Ctrl+C abort</Text>
      </Box>
    )
  }

  const before = value.slice(0, cursor)
  const after = value.slice(cursor)
  const slashOpen = value.startsWith("/")
  const slashMatches = slashOpen ? filterSlashCommands(value) : []

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={t.gold}>{mode} › </Text>
        <Text color={t.bone}>{before}</Text>
        <Text color={t.gold}>█</Text>
        <Text color={t.bone}>{after}</Text>
      </Text>
      {slashOpen ? (
        <Box flexDirection="column" marginTop={1}>
          {slashMatches.length === 0 ? (
            <Text color={t.boneDim}>no matching commands</Text>
          ) : (
            slashMatches.map((c, i) => (
              <Text key={c.id} color={i === slashIdx ? t.gold : t.boneDim}>
                {i === slashIdx ? "❯ " : "  "}/{c.id}
                <Text color={t.boneDim}>  {c.hint}</Text>
              </Text>
            ))
          )}
          <Text color={t.boneDim}>↑↓ select · Enter run · Esc clear</Text>
        </Box>
      ) : null}
      {scrollable ? (
        <Text color={t.boneDim}>scroll: wheel · Ctrl+U/D</Text>
      ) : null}
    </Box>
  )
}
