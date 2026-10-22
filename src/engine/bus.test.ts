import { expect, test } from "bun:test"
import { EventBus } from "./bus"

test("bus publishes in order and tracks sequence", () => {
  const bus = new EventBus<{ type: "a" | "b"; n: number }>()
  const seen: number[] = []
  const off = bus.subscribe("a", (e) => seen.push(e.n))
  expect(bus.publish({ type: "a", n: 1 })).toBe(1)
  expect(bus.publish({ type: "b", n: 2 })).toBe(2)
  expect(bus.publish({ type: "a", n: 3 })).toBe(3)
  expect(seen).toEqual([1, 3])
  off()
  bus.publish({ type: "a", n: 4 })
  expect(seen).toEqual([1, 3])
})

test("subscribeAll sees every event", () => {
  const bus = new EventBus<{ type: "a" | "b" }>()
  const all: string[] = []
  bus.subscribeAll((e) => all.push(e.type))
  bus.publish({ type: "a" })
  bus.publish({ type: "b" })
  expect(all).toEqual(["a", "b"])
  expect(bus.sequence).toBe(2)
})
