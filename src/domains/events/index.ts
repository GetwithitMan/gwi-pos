/**
 * Events Domain
 *
 * Manages event creation, ticketing, and check-in.
 *
 * Modules:
 * - EV1: Event Management (create, edit, cancel)
 * - EV2: Ticketing (ticket types, pricing)
 * - EV3: Check-In (scan, validate, admit)
 * - EV4: Event Sales (at-door, online)
 * - EV5: Event Reporting (attendance, revenue)
 */

// Types will be added as we migrate
export type Event = {
  id: string
  locationId: string
  name: string
  description?: string
  startDate: Date
  endDate?: Date
  capacity?: number
  ticketsSold: number
  status: EventStatus
}

export type EventTicket = {
  id: string
  eventId: string
  type: TicketType
  price: number
  quantity: number
  soldCount: number
}

export type EventCheckIn = {
  id: string
  eventId: string
  ticketId: string
  customerId?: string
  checkedInAt: Date
  checkedInBy: string
}

export type EventStatus =
  | 'draft'
  | 'published'
  | 'selling'
  | 'sold_out'
  | 'in_progress'
  | 'completed'
  | 'cancelled'

export type TicketType =
  | 'general'
  | 'vip'
  | 'early_bird'
  | 'student'
  | 'group'

// Constants
export const EVENT_STATUSES = [
  'draft',
  'published',
  'selling',
  'sold_out',
  'in_progress',
  'completed',
  'cancelled',
] as const
