import { useState } from "react"
import { Box, Text, useInput } from "ink"

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

  return (
    <Box flexDirection="column">
      <Text>
        {props.label}
        <Text color="cyan">{shown}</Text>
        <Text dimColor>█</Text>
      </Text>
      <Text dimColor>Enter confirm · Esc cancel</Text>
    </Box>
  )
}
