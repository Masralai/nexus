import React, { useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import { theme } from "./theme"

export interface PickerItem {
  id: string
  label: string
  searchText?: string
}

const MAX_VISIBLE = 8

function matches(item: PickerItem, q: string): boolean {
  const hay = `${item.id} ${item.label} ${item.searchText ?? ""}`.toLowerCase()
  return hay.includes(q)
}

export function Picker(props: {
  title: string
  items: PickerItem[]
  searchable?: boolean
  onSelect: (id: string) => void
  onCancel?: () => void
  selectedColor?: string
}) {
  const [idx, setIdx] = useState(0)
  const [query, setQuery] = useState("")
  const filtered = useMemo(() => {
    if (!props.searchable || !query.trim()) return props.items
    const q = query.trim().toLowerCase()
    return props.items.filter((it) => matches(it, q))
  }, [props.items, props.searchable, query])
  const n = Math.max(filtered.length, 1)

  useInput((input, key) => {
    if (key.escape) {
      props.onCancel?.()
      return
    }
    if (props.searchable && input && !key.ctrl && !key.meta && input.length === 1 && input >= " ") {
      setQuery((q) => q + input)
      setIdx(0)
      return
    }
    if (props.searchable && (key.backspace || input === "\x7f")) {
      setQuery((q) => q.slice(0, -1))
      setIdx(0)
      return
    }
    if (filtered.length === 0) return
    if (key.upArrow) setIdx((i) => (i - 1 + n) % n)
    else if (key.downArrow) setIdx((i) => (i + 1) % n)
    else if (key.return && filtered[idx]) props.onSelect(filtered[idx].id)
  })

  const t = theme()
  const themed = props.selectedColor !== undefined
  const selected = props.selectedColor ?? "cyan"

  // Viewport: show MAX_VISIBLE items centered around idx
  const total = filtered.length
  let viewStart = 0
  let viewEnd = total
  if (total > MAX_VISIBLE) {
    viewStart = Math.max(0, idx - MAX_VISIBLE + 1)
    viewEnd = Math.min(total, viewStart + MAX_VISIBLE)
    // Ensure idx is always visible
    if (idx < viewStart) viewStart = idx
    if (idx >= viewEnd) viewEnd = idx + 1
    viewStart = Math.max(0, viewEnd - MAX_VISIBLE)
  }

  const visible = filtered.slice(viewStart, viewEnd)
  const aboveCount = viewStart
  const belowCount = total - viewEnd

  return (
    <Box flexDirection="column">
      {props.title ? (
        <Text color={themed ? t.bone : undefined} bold>
          {props.title}
        </Text>
      ) : null}
      {props.searchable ? (
        <Text color={themed ? t.boneDim : undefined}>
          search: {query || "…"}
        </Text>
      ) : null}
      {total === 0 ? (
        <Text color={themed ? t.boneDim : undefined}>no matches</Text>
      ) : (
        <>
          {aboveCount > 0 && (
            <Text color={themed ? t.boneDim : undefined} dimColor>
              ↑ {aboveCount} more
            </Text>
          )}
          {visible.map((it, vi) => {
            const realIdx = viewStart + vi
            return (
              <Text key={it.id} color={realIdx === idx ? selected : themed ? t.boneDim : undefined}>
                {realIdx === idx ? "❯ " : "  "}
                {it.label}
              </Text>
            )
          })}
          {belowCount > 0 && (
            <Text color={themed ? t.boneDim : undefined} dimColor>
              ↓ {belowCount} more
            </Text>
          )}
        </>
      )}
      <Text color={themed ? t.boneDim : undefined} dimColor={!themed}>
        {props.searchable ? "type to filter · " : ""}↑↓ select · Enter confirm · Esc cancel
      </Text>
    </Box>
  )
}
