export type BusListener<T> = (event: T) => void

/**
 * In-process event fan-out with a monotonically increasing sequence number.
 * Persistence to event_sequence is a separate concern (M2 streaming).
 */
export class EventBus<T extends { type: string }> {
  private listeners = new Map<string, Set<BusListener<T>>>()
  private any = new Set<BusListener<T>>()
  private current = 0

  get sequence(): number {
    return this.current
  }

  subscribe(type: T["type"], listener: BusListener<T>): () => void {
    const set = this.listeners.get(type) ?? new Set<BusListener<T>>()
    set.add(listener)
    this.listeners.set(type, set)
    return () => set.delete(listener)
  }

  subscribeAll(listener: BusListener<T>): () => void {
    this.any.add(listener)
    return () => this.any.delete(listener)
  }

  publish(event: T): number {
    this.current++
    for (const listener of this.listeners.get(event.type) ?? []) listener(event)
    for (const listener of this.any) listener(event)
    return this.current
  }
}
