import { Box, Text } from "ink"
import { Picker } from "./picker"
import { theme } from "./theme"

function shortInput(value: unknown): string {
  const s = JSON.stringify(value)
  return s.length > 80 ? `${s.slice(0, 80)}…` : s
}

export function PermissionGate(props: {
  name: string
  reason: string
  input: unknown
  onResolve: (ok: boolean) => void
}) {
  const t = theme()
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={t.crimson} paddingX={1}>
      <Text color={t.crimson} bold>
        Permission gate
      </Text>
      <Text color={t.bone}>{props.name}</Text>
      <Text color={t.boneDim}>{props.reason}</Text>
      <Text color={t.steel}>{shortInput(props.input)}</Text>
      <Picker
        title=""
        items={[
          { id: "yes", label: "Approve" },
          { id: "no", label: "Deny" },
        ]}
        selectedColor={t.gold}
        onSelect={(id) => props.onResolve(id === "yes")}
        onCancel={() => props.onResolve(false)}
      />
    </Box>
  )
}
