/**
 * Floor Plan ↔ Events Bridge
 *
 * Connects floor plan with event seating and venue setup.
 */

export interface FloorToEventsBridge {
  /** Get event for a date/time */
  getEventForDateTime(locationId: string, dateTime: Date): Promise<{
    id: string
    name: string
    capacity: number
    layoutOverride?: string
  } | null>

  /** Check if floor plan should use event layout */
  getEventLayoutOverride(locationId: string): Promise<string | null>
}

export interface EventsToFloorBridge {
  /** Get available capacity for event */
  getAvailableCapacity(eventId: string): Promise<number>

  /** Reserve tables for event */
  reserveTablesForEvent(eventId: string, tableIds: string[]): Promise<boolean>
}

export const floorToEventsBridge: FloorToEventsBridge = {
  getEventForDateTime: async () => null,
  getEventLayoutOverride: async () => null,
}

export const eventsToFloorBridge: EventsToFloorBridge = {
  getAvailableCapacity: async () => 0,
  reserveTablesForEvent: async () => true,
}
