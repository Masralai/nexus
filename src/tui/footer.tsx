import { Box, Text } from "ink"
import type { FooterView } from "./present"
import type { Theme } from "./theme"

export function Footer({ footer: f, cols, t }: { footer: FooterView; cols: number; t: Theme }) {
  const pct = f.ctxLimit ? `${(f.ctxPct * 100).toFixed(0)}%` : "0%"
  const skills = f.skills.length ? f.skills.join("+") : ""
  return (
    <Box flexDirection="column">
      <Text color={t.boneDim}>{"─".repeat(Math.max(8, cols))}</Text>
      <Text>
        <Text color={t.boneDim}>MODE </Text>
        <Text color={f.mode === "plan" ? t.steel : t.bone}>{f.mode}</Text>
        <Text color={t.boneDim}>  ·  MODEL </Text>
        <Text color={t.bone}>{f.model}</Text>
        {skills ? (
          <>
            <Text color={t.boneDim}>  ·  SKILLS </Text>
            <Text color={t.bone}>{skills}</Text>
          </>
        ) : null}
        <Text color={t.boneDim}>  ·  CTX </Text>
        <Text color={t.bone}>
          {f.ctxUsed}/{f.ctxLimit} ({pct})
        </Text>
        {f.steps ? (
          <>
            <Text color={t.boneDim}>  ·  steps </Text>
            <Text color={t.bone}>{f.steps}</Text>
          </>
        ) : null}
        {!f.connected ? <Text color={t.crimson}>  ·  not connected</Text> : null}
      </Text>
    </Box>
  )
}
