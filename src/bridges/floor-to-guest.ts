/**
 * Floor Plan ↔ Guest Bridge
 *
 * Connects floor plan with guest profiles and reservations.
 */

export interface FloorToGuestBridge {
  /** Get reservation for a table */
  getReservationForTable(tableId: string, dateTime: Date): Promise<{
    id: string
    guestName: string
    partySize: number
    time: Date
    notes?: string
  } | null>

  /** Get upcoming reservations */
  getUpcomingReservations(locationId: string, hours: number): Promise<Array<{
    id: string
    guestName: string
    partySize: number
    time: Date
    tableId?: string
  }>>

  /** Get guest preferences */
  getGuestPreferences(customerId: string): Promise<{
    preferredSection?: string
    dietaryRestrictions?: string[]
    seatingPreference?: string
  }>
}

export interface GuestToFloorBridge {
  /** Find suitable tables for reservation */
  findAvailableTables(partySize: number, dateTime: Date): Promise<string[]>

  /** Assign reservation to table */
  assignTableToReservation(reservationId: string, tableId: string): Promise<boolean>
}

export const floorToGuestBridge: FloorToGuestBridge = {
  getReservationForTable: async () => null,
  getUpcomingReservations: async () => [],
  getGuestPreferences: async () => ({}),
}

export const guestToFloorBridge: GuestToFloorBridge = {
  findAvailableTables: async () => [],
  assignTableToReservation: async () => true,
}
