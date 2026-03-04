/**
 * Short-lived in-memory store for server-trusted room-charge guest selections.
 *
 * After a successful guest lookup, the server creates a selection token.
 * The client sends only the selectionId (not raw OPERA reservation IDs) to /pay.
 * The /pay route loads and validates the selection server-side.
 *
 * TTL: 10 minutes. NUC is a persistent process — in-memory is appropriate.
 * One-time use: selection is deleted on consumption to prevent replay.
 */

import { randomBytes } from 'crypto'

export interface RoomChargeSelection {
  selectionId: string
  locationId: string
  reservationId: string
  roomNumber: string
  guestName: string
  checkInDate: string
  checkOutDate: string
  employeeId: string | null
  createdAt: number   // Date.now() ms
}

const SELECTION_TTL_MS = 10 * 60 * 1000   // 10 minutes

const selections = new Map<string, RoomChargeSelection>()

// Periodic cleanup — runs every 5 minutes, prevents unbounded growth
const cleanupInterval = setInterval(() => {
  const cutoff = Date.now() - SELECTION_TTL_MS
  for (const [id, sel] of selections) {
    if (sel.createdAt < cutoff) selections.delete(id)
  }
}, 5 * 60 * 1000)

// Allow garbage collection in test environments
if (typeof cleanupInterval.unref === 'function') cleanupInterval.unref()

/**
 * Create a new selection token for a successfully looked-up guest.
 * Returns the selectionId to send back to the client.
 */
export function createRoomChargeSelection(
  data: Omit<RoomChargeSelection, 'selectionId' | 'createdAt'>
): string {
  const selectionId = randomBytes(24).toString('hex')
  selections.set(selectionId, { ...data, selectionId, createdAt: Date.now() })
  return selectionId
}

/**
 * Consume a selection by ID. Returns the selection data if valid, null otherwise.
 * One-time use: deletes the selection regardless of success/failure to prevent replay.
 */
export function consumeRoomChargeSelection(
  selectionId: string,
  locationId: string
): RoomChargeSelection | null {
  const sel = selections.get(selectionId)

  // Always delete — one-time use
  selections.delete(selectionId)

  if (!sel) return null
  if (sel.locationId !== locationId) return null
  if (Date.now() - sel.createdAt > SELECTION_TTL_MS) return null

  return sel
}
