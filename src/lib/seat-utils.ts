/**
 * Seat Management Utilities (Skill 121)
 *
 * Per-seat balance calculations and status determination.
 */

// Module-level tax rate, updated by useOrderSettings when location settings load.
// Starts at 0 (not hardcoded 8%) — if settings fail to load, zero tax is obvious to the user.
// Callers can pass an explicit taxRate to override; this is the fallback default.
let _locationTaxRate = 0

/** Update the cached location tax rate (called from useOrderSettings on load). */
export function setLocationTaxRate(rate: number) {
  _locationTaxRate = rate
}

/** Get the current cached location tax rate. */
export function getLocationTaxRate(): number {
  return _locationTaxRate
}

export type SeatStatus = 'empty' | 'stale' | 'active' | 'printed' | 'paid'

export interface SeatInfo {
  seatNumber: number
  subtotal: number
  taxAmount: number
  total: number
  itemCount: number
  status: SeatStatus
  addedAt?: string
}

export interface OrderItemForSeat {
  id: string
  seatNumber?: number | null
  price: number
  quantity: number
  kitchenStatus?: string
  status?: string
  createdAt?: Date | string
  updatedAt?: Date | string
  modifiers?: { price: number }[]
}

export interface PaymentForSeat {
  metadata?: { seatNumber?: number } | null
  status: string
}

/**
 * Seat status color mapping
 */
export const SEAT_STATUS_COLORS: Record<SeatStatus, string> = {
  empty: '#6b7280',     // gray-500 - No items
  stale: '#f59e0b',     // amber-500 - Items but no recent activity
  active: '#22c55e',    // green-500 - Recent activity
  printed: '#3b82f6',   // blue-500 - Items sent to kitchen
  paid: '#a855f7',      // purple-500 - Seat fully paid
}

/**
 * Seat status background colors (lighter variants)
 */
export const SEAT_STATUS_BG_COLORS: Record<SeatStatus, string> = {
  empty: 'rgba(107, 114, 128, 0.2)',
  stale: 'rgba(245, 158, 11, 0.2)',
  active: 'rgba(34, 197, 94, 0.2)',
  printed: 'rgba(59, 130, 246, 0.2)',
  paid: 'rgba(168, 85, 247, 0.2)',
}

/**
 * Seat status glow colors for selected state
 */
export const SEAT_STATUS_GLOW: Record<SeatStatus, string> = {
  empty: 'rgba(107, 114, 128, 0.5)',
  stale: 'rgba(245, 158, 11, 0.5)',
  active: 'rgba(34, 197, 94, 0.5)',
  printed: 'rgba(59, 130, 246, 0.5)',
  paid: 'rgba(168, 85, 247, 0.5)',
}

/**
 * Calculate per-seat balance
 */
export function calculateSeatBalance(
  items: OrderItemForSeat[],
  seatNumber: number,
  taxRate: number = _locationTaxRate
): { subtotal: number; taxAmount: number; total: number; itemCount: number } {
  const seatItems = items.filter(item => item.seatNumber === seatNumber)

  const subtotal = seatItems.reduce((sum, item) => {
    const itemBase = Number(item.price) * item.quantity
    const modTotal = (item.modifiers || []).reduce((m, mod) => m + Number(mod.price), 0) * item.quantity
    return sum + itemBase + modTotal
  }, 0)

  const taxAmount = Math.round(subtotal * taxRate * 100) / 100
  const total = Math.round((subtotal + taxAmount) * 100) / 100
  const itemCount = seatItems.reduce((sum, item) => sum + item.quantity, 0)

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    taxAmount,
    total,
    itemCount,
  }
}

/**
 * Determine seat status based on items and payments
 */
export function determineSeatStatus(
  items: OrderItemForSeat[],
  seatNumber: number,
  payments: PaymentForSeat[] = [],
  staleThresholdMinutes: number = 5
): SeatStatus {
  // Check if seat is paid
  const isPaid = payments.some(p =>
    p.status === 'completed' &&
    (p.metadata as { seatNumber?: number } | null)?.seatNumber === seatNumber
  )
  if (isPaid) return 'paid'

  const seatItems = items.filter(item => item.seatNumber === seatNumber)
  if (seatItems.length === 0) return 'empty'

  // Check if any items have been sent to kitchen
  const hasPrintedItems = seatItems.some(item =>
    item.kitchenStatus && item.kitchenStatus !== 'pending'
  )
  if (hasPrintedItems) return 'printed'

  // Check for recent activity
  const staleThreshold = new Date(Date.now() - staleThresholdMinutes * 60 * 1000)
  const hasRecentActivity = seatItems.some(item => {
    const updated = item.updatedAt ? new Date(item.updatedAt) : null
    const created = item.createdAt ? new Date(item.createdAt) : null
    return (updated && updated > staleThreshold) || (created && created > staleThreshold)
  })

  return hasRecentActivity ? 'active' : 'stale'
}

/**
 * Calculate all seat balances for an order
 */
export function calculateAllSeatBalances(
  items: OrderItemForSeat[],
  totalSeats: number,
  payments: PaymentForSeat[] = [],
  taxRate: number = _locationTaxRate
): SeatInfo[] {
  const seats: SeatInfo[] = []

  for (let seatNum = 1; seatNum <= totalSeats; seatNum++) {
    const balance = calculateSeatBalance(items, seatNum, taxRate)
    const status = determineSeatStatus(items, seatNum, payments)

    seats.push({
      seatNumber: seatNum,
      ...balance,
      status,
    })
  }

  return seats
}

/**
 * Position seats around a circular orbit
 */
export function calculateSeatPositions(
  seatCount: number,
  orbitRadius: number,
  startAngle: number = -90 // Start at top
): { x: number; y: number; angle: number }[] {
  const positions: { x: number; y: number; angle: number }[] = []
  const angleStep = 360 / seatCount

  for (let i = 0; i < seatCount; i++) {
    const angle = startAngle + i * angleStep
    const radians = (angle * Math.PI) / 180
    const x = Math.cos(radians) * orbitRadius
    const y = Math.sin(radians) * orbitRadius

    positions.push({ x, y, angle })
  }

  return positions
}

/**
 * Format currency for display
 */
export function formatSeatBalance(amount: number): string {
  if (amount === 0) return ''
  return `$${amount.toFixed(2)}`
}
