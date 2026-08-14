import { Box, Text } from "ink"
import type { HeaderView } from "./present"
import type { Theme } from "./theme"

export function Header({ header: h, cols, t }: { header: HeaderView; cols: number; t: Theme }) {
  const pct = h.ctxLimit ? `${(h.ctxPct * 100).toFixed(0)}%` : "0%"
  const skills = h.skills.length ? h.skills.join("+") : ""
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={t.boneDim}>SESSION </Text>
        <Text color={t.bone}>{h.session}</Text>
        <Text color={t.boneDim}>  ·  MODE </Text>
        <Text color={h.mode === "plan" ? t.steel : t.bone}>{h.mode}</Text>
        <Text color={t.boneDim}>  ·  MODEL </Text>
        <Text color={t.bone}>{h.model}</Text>
        {skills ? (
          <>
            <Text color={t.boneDim}>  ·  SKILLS </Text>
            <Text color={t.bone}>{skills}</Text>
          </>
        ) : null}
        <Text color={t.boneDim}>  ·  CTX </Text>
        <Text color={t.bone}>
          {h.ctxUsed}/{h.ctxLimit} ({pct})
        </Text>
        {h.steps ? (
          <>
            <Text color={t.boneDim}>  ·  steps </Text>
            <Text color={t.bone}>{h.steps}</Text>
          </>
        ) : null}
        {!h.connected ? <Text color={t.crimson}>  ·  not connected</Text> : null}
      </Text>
      <Text color={t.boneDim}>{"─".repeat(Math.max(8, cols))}</Text>
    </Box>
  )
}
