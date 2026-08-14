import React, { useState } from "react"
import { Box, Text, useInput } from "ink"
import { theme } from "./theme"

export interface PickerItem {
  id: string
  label: string
}

export function Picker(props: {
  title: string
  items: PickerItem[]
  onSelect: (id: string) => void
  onCancel?: () => void
  selectedColor?: string
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

  const t = theme()
  const themed = props.selectedColor !== undefined
  const selected = props.selectedColor ?? "cyan"
  return (
    <Box flexDirection="column">
      {props.title ? (
        <Text color={themed ? t.bone : undefined} bold>
          {props.title}
        </Text>
      ) : null}
      {props.items.map((it, i) => (
        <Text key={it.id} color={i === idx ? selected : themed ? t.boneDim : undefined}>
          {i === idx ? "❯ " : "  "}
          {it.label}
        </Text>
      ))}
      <Text color={themed ? t.boneDim : undefined} dimColor={!themed}>
        ↑↓ select · Enter confirm · Esc cancel
      </Text>
    </Box>
  )
}
