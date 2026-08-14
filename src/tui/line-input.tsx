import { useState } from "react"
import { Box, Text, useInput } from "ink"
import { theme } from "./theme"

export function LineInput(props: {
  label: string
  mask?: boolean
  onSubmit: (value: string) => void
  onCancel?: () => void
}) {
  const [value, setValue] = useState("")

  useInput((input, key) => {
    if (key.escape) {
      props.onCancel?.()
      return
    }
    if (key.return) {
      props.onSubmit(value)
      return
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1))
      return
    }
    if (key.ctrl || key.meta) return
    if (input && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setValue((v) => v + input)
    }
  })

  const shown = props.mask ? "•".repeat(value.length) : value
  const t = theme()

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={t.bone}>{props.label}</Text>
        <Text color={t.gold}>{shown}</Text>
        <Text color={t.gold}>█</Text>
      </Text>
      <Text color={t.boneDim}>Enter confirm · Esc cancel</Text>
    </Box>
  )
}
