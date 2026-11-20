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
  onResolve: (reply: boolean | "always") => void
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
          { id: "always", label: "Always allow" },
          { id: "no", label: "Deny" },
        ]}
        selectedColor={t.gold}
        onSelect={(id) => props.onResolve(id === "always" ? "always" : id === "yes")}
        onCancel={() => props.onResolve(false)}
      />
    </Box>
  )
}
