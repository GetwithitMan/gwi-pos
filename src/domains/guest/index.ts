/**
 * Guest Domain
 *
 * Manages customer profiles, loyalty, and reservations.
 *
 * Modules:
 * - G1: Profiles (contact info, preferences)
 * - G2: Loyalty (points, rewards, tiers)
 * - G3: Reservations (booking, confirmations)
 * - G4: Preferences (dietary, seating)
 * - G5: History (order history, visits)
 * - G6: Feedback (reviews, complaints)
 * - G7: Marketing (campaigns, segments)
 */

// Types will be added as we migrate
export type Customer = {
  id: string
  firstName: string
  lastName: string
  email?: string
  phone?: string
  loyaltyPoints: number
  visitCount: number
}

export type Reservation = {
  id: string
  customerId?: string
  guestName: string
  partySize: number
  dateTime: Date
  status: ReservationStatus
  tableId?: string
  notes?: string
}

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'seated'
  | 'completed'
  | 'cancelled'
  | 'no_show'

// Constants
export const LOYALTY_TIERS = [
  'bronze',
  'silver',
  'gold',
  'platinum',
] as const
