/**
 * Seat Service - L3 Seats
 *
 * Provides seat management operations for the Floor Plan domain.
 * Handles auto-positioning, status tracking, and seat assignment.
 */

import { db } from '@/shared'
import { SeatType } from '@prisma/client'
import type { Seat, SeatPosition } from '../types'

// Re-export existing seat utilities
export {
  calculateSeatBalance,
  determineSeatStatus,
  SEAT_STATUS_COLORS,
  SEAT_STATUS_BG_COLORS,
  SEAT_STATUS_GLOW,
} from '@/lib/seat-utils'

export type { SeatStatus, SeatInfo, OrderItemForSeat, PaymentForSeat } from '@/lib/seat-utils'

/**
 * Get all seats for a table
 */
export async function getSeatsForTable(tableId: string): Promise<Seat[]> {
  const seats = await db.seat.findMany({
    where: {
      tableId,
      deletedAt: null,
    },
    orderBy: { seatNumber: 'asc' },
  })

  return seats.map(mapPrismaSeatToDomain)
}

/**
 * Get a single seat by ID
 */
export async function getSeatById(seatId: string): Promise<Seat | null> {
  const seat = await db.seat.findUnique({
    where: { id: seatId },
  })

  if (!seat) return null
  return mapPrismaSeatToDomain(seat)
}

/**
 * Auto-generate seats for a table based on shape and capacity
 */
export async function autoGenerateSeats(
  tableId: string,
  capacity: number,
  shape: string
): Promise<Seat[]> {
  // Get table to find locationId
  const table = await db.table.findUnique({
    where: { id: tableId },
    select: { locationId: true },
  })

  if (!table) {
    throw new Error('Table not found')
  }

  // Delete existing seats
  await db.seat.updateMany({
    where: { tableId },
    data: { deletedAt: new Date() },
  })

  // Generate new seats based on shape
  const positions = calculateSeatPositions(capacity, shape)

  const seats = await Promise.all(
    positions.map((pos, index) =>
      db.seat.create({
        data: {
          locationId: table.locationId,
          tableId,
          seatNumber: index + 1,
          label: `${index + 1}`,
          relativeX: Math.round(pos.x * 100), // Convert to int pixels
          relativeY: Math.round(pos.y * 100),
          angle: Math.round(pos.angle),
          seatType: 'standard',
        },
      })
    )
  )

  return seats.map(mapPrismaSeatToDomain)
}

/**
 * Add a virtual seat (server-added during service)
 */
export async function addVirtualSeat(
  tableId: string,
  position: SeatPosition
): Promise<Seat> {
  // Get table to find locationId
  const table = await db.table.findUnique({
    where: { id: tableId },
    select: { locationId: true },
  })

  if (!table) {
    throw new Error('Table not found')
  }

  // Get next seat number
  const maxSeat = await db.seat.findFirst({
    where: { tableId, deletedAt: null },
    orderBy: { seatNumber: 'desc' },
  })

  const nextNumber = (maxSeat?.seatNumber || 0) + 1

  const seat = await db.seat.create({
    data: {
      locationId: table.locationId,
      tableId,
      seatNumber: nextNumber,
      label: `V${nextNumber}`,
      relativeX: Math.round(position.x * 100), // Convert to int pixels
      relativeY: Math.round(position.y * 100),
      angle: Math.round(position.angle),
      seatType: 'virtual' as unknown as SeatType,
    },
  })

  return mapPrismaSeatToDomain(seat)
}

/**
 * Update seat occupancy
 */
export async function updateSeatOccupancy(
  seatId: string,
  isOccupied: boolean,
  guestId?: string
): Promise<Seat> {
  const seat = await db.seat.update({
    where: { id: seatId },
    data: {
      // Note: These fields may need to be added to the schema
      // isOccupied,
      // guestId,
    },
  })

  return mapPrismaSeatToDomain(seat)
}

/**
 * Calculate seat positions based on shape
 */
function calculateSeatPositions(
  capacity: number,
  shape: string
): Array<{ x: number; y: number; angle: number }> {
  const positions: Array<{ x: number; y: number; angle: number }> = []

  switch (shape) {
    case 'circle':
      // Distribute evenly around circle
      for (let i = 0; i < capacity; i++) {
        const angle = (i / capacity) * 360
        const radians = (angle * Math.PI) / 180
        positions.push({
          x: Math.cos(radians) * 0.6, // 60% from center
          y: Math.sin(radians) * 0.6,
          angle,
        })
      }
      break

    case 'booth':
      // Seats only on interior
      for (let i = 0; i < capacity; i++) {
        positions.push({
          x: 0.2 + (i / Math.max(1, capacity - 1)) * 0.6,
          y: 0.3,
          angle: 180,
        })
      }
      break

    case 'bar':
      // Seats on one side only
      for (let i = 0; i < capacity; i++) {
        positions.push({
          x: 0.1 + (i / Math.max(1, capacity - 1)) * 0.8,
          y: -0.3,
          angle: 0,
        })
      }
      break

    default:
      // Rectangle/square - distribute around perimeter
      const sides = {
        top: Math.ceil(capacity / 4),
        right: Math.ceil(capacity / 4),
        bottom: Math.ceil(capacity / 4),
        left: capacity - Math.ceil(capacity / 4) * 3,
      }

      let seatIndex = 0

      // Top side
      for (let i = 0; i < sides.top && seatIndex < capacity; i++) {
        positions.push({
          x: 0.1 + (i / Math.max(1, sides.top - 1)) * 0.8,
          y: -0.4,
          angle: 0,
        })
        seatIndex++
      }

      // Right side
      for (let i = 0; i < sides.right && seatIndex < capacity; i++) {
        positions.push({
          x: 1.1,
          y: 0.1 + (i / Math.max(1, sides.right - 1)) * 0.8,
          angle: 90,
        })
        seatIndex++
      }

      // Bottom side
      for (let i = 0; i < sides.bottom && seatIndex < capacity; i++) {
        positions.push({
          x: 0.9 - (i / Math.max(1, sides.bottom - 1)) * 0.8,
          y: 1.1,
          angle: 180,
        })
        seatIndex++
      }

      // Left side
      for (let i = 0; i < sides.left && seatIndex < capacity; i++) {
        positions.push({
          x: -0.1,
          y: 0.9 - (i / Math.max(1, sides.left - 1)) * 0.8,
          angle: 270,
        })
        seatIndex++
      }
      break
  }

  return positions
}

/**
 * Map Prisma seat to domain Seat type
 */
function mapPrismaSeatToDomain(prismaSeat: any): Seat {
  return {
    id: prismaSeat.id,
    tableId: prismaSeat.tableId,
    number: prismaSeat.seatNumber,
    position: {
      angle: prismaSeat.angle || 0,
      distance: 0.5, // Default distance
      x: prismaSeat.relativeX || 0,
      y: prismaSeat.relativeY || 0,
    },
    isVirtual: prismaSeat.seatType === 'virtual',
    isOccupied: false, // Would come from order data via bridge
    guestId: undefined,
    orderId: undefined,
  }
}
