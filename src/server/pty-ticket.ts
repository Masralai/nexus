import { randomUUID } from "node:crypto"

export interface PtyConnectToken {
  ticket: string
  expires_in: number
}

export interface PtyTicketStore {
  issue(ptyID: string): PtyConnectToken
  /** Single-use. Consumes the ticket only when the id and secret match. */
  redeem(ptyID: string, ticket: string): boolean
}

export class MemoryPtyTickets implements PtyTicketStore {
  private tickets = new Map<string, { ptyID: string; expiresAt: number }>()
  private ttlMs: number

  constructor(ttlMs = 30_000) {
    this.ttlMs = ttlMs
  }

  private prune(now = Date.now()): void {
    for (const [ticket, entry] of this.tickets) {
      if (entry.expiresAt <= now) this.tickets.delete(ticket)
    }
  }

  issue(ptyID: string): PtyConnectToken {
    this.prune()
    const ticket = randomUUID()
    this.tickets.set(ticket, { ptyID, expiresAt: Date.now() + this.ttlMs })
    return { ticket, expires_in: Math.ceil(this.ttlMs / 1000) }
  }

  redeem(ptyID: string, ticket: string): boolean {
    this.prune()
    const entry = this.tickets.get(ticket)
    if (!entry || entry.ptyID !== ptyID) return false
    this.tickets.delete(ticket)
    return true
  }
}
