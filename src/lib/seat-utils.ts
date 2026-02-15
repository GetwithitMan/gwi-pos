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
 * Per-seat-number color palette (8 high-contrast colors for dark backgrounds).
 * Seat 1 → index 0, Seat 2 → index 1, etc. Wraps via modulo.
 */
export const SEAT_COLORS: string[] = [
  '#6366f1', // indigo-500
  '#f59e0b', // amber-500
  '#10b981', // emerald-500
  '#ef4444', // red-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
]

const SEAT_EMPTY_COLOR = '#6b7280' // gray-500

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

/** Get the solid color for a seat number. Grey when hasItems is false. */
export function getSeatColor(seatNumber: number, hasItems: boolean = true): string {
  if (!hasItems) return SEAT_EMPTY_COLOR
  return SEAT_COLORS[(seatNumber - 1) % SEAT_COLORS.length]
}

/** Get the background rgba color for a seat badge/header. */
export function getSeatBgColor(seatNumber: number | null | undefined): string {
  if (!seatNumber) return 'rgba(255, 255, 255, 0.05)'
  const { r, g, b } = hexToRgb(SEAT_COLORS[(seatNumber - 1) % SEAT_COLORS.length])
  return `rgba(${r}, ${g}, ${b}, 0.15)`
}

/** Get the text color for a seat badge/header (lightened variant). */
export function getSeatTextColor(seatNumber: number | null | undefined): string {
  if (!seatNumber) return '#94a3b8'
  const { r, g, b } = hexToRgb(SEAT_COLORS[(seatNumber - 1) % SEAT_COLORS.length])
  return `rgb(${Math.min(255, r + 80)}, ${Math.min(255, g + 80)}, ${Math.min(255, b + 80)})`
}

/** Get the border rgba for a seat badge. */
export function getSeatBorderColor(seatNumber: number | null | undefined): string {
  if (!seatNumber) return 'rgba(255, 255, 255, 0.1)'
  const { r, g, b } = hexToRgb(SEAT_COLORS[(seatNumber - 1) % SEAT_COLORS.length])
  return `rgba(${r}, ${g}, ${b}, 0.3)`
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
 * Calculate orbit radius for seat positioning based on table dimensions
 */
export function calculateOrbitRadius(tableWidth: number, tableHeight: number): number {
  return Math.max(tableWidth, tableHeight) / 2 + 20
}

/**
 * Minimum center-to-center distance between seats (px).
 * Seats render as 24×24 circles; 30px gives a 6px gap.
 */
const MIN_SEAT_DISTANCE = 30

/**
 * Find a collision-free position for a new seat given existing seat positions.
 *
 * Strategy:
 * 1. Generate N candidate orbital slots (evenly spaced around the table)
 * 2. Score each slot by distance to the nearest existing seat
 * 3. Pick the slot with the largest gap (farthest from all existing seats)
 * 4. If the best slot still collides, nudge outward along its angle until clear
 */
export function findCollisionFreePosition(
  existingPositions: { x: number; y: number }[],
  orbitRadius: number,
  candidateCount: number = 36, // try every 10°
): { x: number; y: number; angle: number } {
  if (existingPositions.length === 0) {
    // No existing seats — place at top (12 o'clock)
    return { x: 0, y: -orbitRadius, angle: -90 }
  }

  const candidates = calculateSeatPositions(candidateCount, orbitRadius)

  // Score each candidate by min distance to any existing seat
  let bestCandidate = candidates[0]
  let bestMinDist = -Infinity

  for (const candidate of candidates) {
    let minDist = Infinity
    for (const existing of existingPositions) {
      const dx = candidate.x - existing.x
      const dy = candidate.y - existing.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < minDist) minDist = dist
    }
    if (minDist > bestMinDist) {
      bestMinDist = minDist
      bestCandidate = candidate
    }
  }

  // If the best slot still collides, nudge outward along its angle
  if (bestMinDist < MIN_SEAT_DISTANCE) {
    const angle = Math.atan2(bestCandidate.y, bestCandidate.x)
    let r = orbitRadius
    for (let attempt = 0; attempt < 5; attempt++) {
      r += MIN_SEAT_DISTANCE
      const nudgedX = Math.cos(angle) * r
      const nudgedY = Math.sin(angle) * r
      let clear = true
      for (const existing of existingPositions) {
        const dx = nudgedX - existing.x
        const dy = nudgedY - existing.y
        if (Math.sqrt(dx * dx + dy * dy) < MIN_SEAT_DISTANCE) {
          clear = false
          break
        }
      }
      if (clear) {
        return {
          x: nudgedX,
          y: nudgedY,
          angle: bestCandidate.angle,
        }
      }
    }
    // Fallback: just use the nudged position at max radius
    return {
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
      angle: bestCandidate.angle,
    }
  }

  return bestCandidate
}

/**
 * Format currency for display
 */
export function formatSeatBalance(amount: number): string {
  if (amount === 0) return ''
  return `$${amount.toFixed(2)}`
}
