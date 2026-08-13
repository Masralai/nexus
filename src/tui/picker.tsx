import React, { useState } from "react"
import { Box, Text, useInput } from "ink"

export interface PickerItem {
  id: string
  label: string
}

export function Picker(props: {
  title: string
  items: PickerItem[]
  onSelect: (id: string) => void
  onCancel?: () => void
}) {
  const [idx, setIdx] = useState(0)
  const n = Math.max(props.items.length, 1)

  useInput((_input, key) => {
    if (key.escape) {
      props.onCancel?.()
      return
    }
    if (props.items.length === 0) return
    if (key.upArrow) setIdx((i) => (i - 1 + n) % n)
    else if (key.downArrow) setIdx((i) => (i + 1) % n)
    else if (key.return && props.items[idx]) props.onSelect(props.items[idx].id)
  })

  return (
    <Box flexDirection="column">
      <Text bold>{props.title}</Text>
      {props.items.map((it, i) => (
        <Text key={it.id} color={i === idx ? "cyan" : undefined}>
          {i === idx ? "❯ " : "  "}
          {it.label}
        </Text>
      ))}
      <Text dimColor>↑↓ select · Enter confirm · Esc cancel</Text>
    </Box>
  )
}
