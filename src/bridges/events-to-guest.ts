/**
 * Events ↔ Guest Bridge
 *
 * Connects events with attendee tracking.
 */

export interface EventsToGuestBridge {
  /** Get customer for ticket purchase */
  getCustomerForTicket(customerId: string): Promise<{
    id: string
    name: string
    email?: string
    phone?: string
  } | null>

  /** Link ticket purchase to customer */
  linkTicketToCustomer(ticketId: string, customerId: string): Promise<boolean>
}

export interface GuestToEventsBridge {
  /** Get events attended by customer */
  getEventsAttended(customerId: string): Promise<string[]>

  /** Get ticket purchase history */
  getTicketHistory(customerId: string): Promise<Array<{
    eventId: string
    eventName: string
    ticketCount: number
    purchaseDate: Date
  }>>
}

export const eventsToGuestBridge: EventsToGuestBridge = {
  getCustomerForTicket: async () => null,
  linkTicketToCustomer: async () => true,
}

export const guestToEventsBridge: GuestToEventsBridge = {
  getEventsAttended: async () => [],
  getTicketHistory: async () => [],
}
