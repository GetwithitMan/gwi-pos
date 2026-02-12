import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationTaxRate, calculateTax } from '@/lib/order-calculations'

/**
 * Atomic Seat Management API (Skill 121)
 *
 * Supports INSERT and REMOVE operations with positional shifting.
 * Uses seatVersion for optimistic concurrency control.
 *
 * INSERT: Add a seat at position N, shift all seats >= N up by 1
 * REMOVE: Remove seat at position N, shift all seats > N down by 1
 */

type SeatTimestamps = Record<string, string>

interface SeatAction {
  action: 'INSERT' | 'REMOVE'
  position: number // 1-based seat position
  seatVersion?: number // For optimistic locking
}

interface SeatBalance {
  seatNumber: number
  subtotal: number
  taxAmount: number
  discountAmount: number
  total: number
  itemCount: number
  status: 'empty' | 'stale' | 'active' | 'printed' | 'paid'
  addedAt?: string
}

/**
 * GET /api/orders/[id]/seating
 *
 * Returns current seating information including per-seat balances
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        location: true,
        items: {
          where: { deletedAt: null },
          include: {
            modifiers: true,
          },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Calculate total seat count
    const totalSeats = order.baseSeatCount + order.extraSeatCount

    // Get tax rate from location settings
    const taxRate = getLocationTaxRate(order.location.settings as { tax?: { defaultRate?: number } })

    // Calculate per-seat balances
    const seatTimestamps = (order.seatTimestamps as SeatTimestamps) || {}
    const seatBalances: SeatBalance[] = []

    // Find which seats have been paid
    // NOTE: Per-seat payment tracking not yet implemented - placeholder for future
    // When split-by-seat payments are implemented, this will track paid seats
    const paidSeats = new Set<number>()

    // Find which seats have printed items (kitchenStatus !== 'pending')
    const printedSeats = new Set<number>()
    for (const item of order.items) {
      if (item.seatNumber && item.kitchenStatus !== 'pending') {
        printedSeats.add(item.seatNumber)
      }
    }

    // Calculate balance for each seat
    for (let seatNum = 1; seatNum <= totalSeats; seatNum++) {
      const seatItems = order.items.filter(item => item.seatNumber === seatNum)
      const itemCount = seatItems.reduce((sum, item) => sum + item.quantity, 0)

      // Calculate subtotal including modifiers
      const subtotal = seatItems.reduce((sum, item) => {
        const itemBase = Number(item.price) * item.quantity
        const modTotal = item.modifiers.reduce((m, mod) => m + Number(mod.price), 0) * item.quantity
        return sum + itemBase + modTotal
      }, 0)

      const taxAmount = calculateTax(subtotal, taxRate)
      const total = subtotal + taxAmount

      // Determine seat status
      let status: SeatBalance['status'] = 'empty'
      if (paidSeats.has(seatNum)) {
        status = 'paid'
      } else if (printedSeats.has(seatNum)) {
        status = 'printed'
      } else if (itemCount > 0) {
        // Check if any item was modified in last 5 minutes
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
        const hasRecentActivity = seatItems.some(item =>
          item.updatedAt > fiveMinutesAgo || item.createdAt > fiveMinutesAgo
        )
        status = hasRecentActivity ? 'active' : 'stale'
      }

      seatBalances.push({
        seatNumber: seatNum,
        subtotal: Math.round(subtotal * 100) / 100,
        taxAmount,
        discountAmount: 0, // TODO: Per-seat discounts
        total: Math.round(total * 100) / 100,
        itemCount,
        status,
        addedAt: seatTimestamps[seatNum.toString()],
      })
    }

    // Items without a seat assignment
    const sharedItems = order.items.filter(item => !item.seatNumber)
    const sharedSubtotal = sharedItems.reduce((sum, item) => {
      const itemBase = Number(item.price) * item.quantity
      const modTotal = item.modifiers.reduce((m, mod) => m + Number(mod.price), 0) * item.quantity
      return sum + itemBase + modTotal
    }, 0)

    return NextResponse.json({
      orderId: order.id,
      baseSeatCount: order.baseSeatCount,
      extraSeatCount: order.extraSeatCount,
      totalSeats,
      seatVersion: order.seatVersion,
      guestCount: order.guestCount,
      seatBalances,
      sharedItems: {
        itemCount: sharedItems.reduce((sum, item) => sum + item.quantity, 0),
        subtotal: Math.round(sharedSubtotal * 100) / 100,
      },
      orderTotal: Number(order.total),
    })
  } catch (error) {
    console.error('Failed to get seating info:', error)
    return NextResponse.json(
      { error: 'Failed to get seating information' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/orders/[id]/seating
 *
 * Performs atomic seat INSERT or REMOVE with positional shifting.
 *
 * INSERT at position 3 with 4 seats:
 *   Before: [S1, S2, S3, S4]
 *   After:  [S1, S2, NEW, S3→S4, S4→S5]
 *   Items on S3 become S4, items on S4 become S5
 *
 * REMOVE at position 2 with 4 seats:
 *   Before: [S1, S2, S3, S4]
 *   After:  [S1, S3→S2, S4→S3]
 *   Items on S2 go to "Shared", items on S3 become S2, etc.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body: SeatAction = await request.json()
    const { action, position, seatVersion } = body

    if (!action || !position) {
      return NextResponse.json(
        { error: 'Action and position are required' },
        { status: 400 }
      )
    }

    if (position < 1) {
      return NextResponse.json(
        { error: 'Position must be >= 1' },
        { status: 400 }
      )
    }

    const result = await db.$transaction(async (tx) => {
      // Get current order state
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            where: { deletedAt: null },
          },
        },
      })

      if (!order) {
        throw new Error('Order not found')
      }

      if (order.status !== 'open') {
        throw new Error('Cannot modify seats on a closed order')
      }

      // Optimistic locking check
      if (seatVersion !== undefined && order.seatVersion !== seatVersion) {
        throw new Error('Seat configuration has changed. Please refresh and try again.')
      }

      const currentTotalSeats = order.baseSeatCount + order.extraSeatCount
      const seatTimestamps = (order.seatTimestamps as SeatTimestamps) || {}

      if (action === 'INSERT') {
        // Allow inserting beyond the order's tracked seat count.
        // The table may have more physical seats than the order was created with
        // (e.g., table has 8 seats but order was started with guestCount 4).
        // We grow extraSeatCount to cover the gap.
        const seatsToAdd = Math.max(1, position - currentTotalSeats)

        // Shift all items with seatNumber >= position up by 1
        const itemsToShift = order.items.filter(
          item => item.seatNumber && item.seatNumber >= position
        )

        // Update items in descending order to avoid conflicts
        const sortedItems = [...itemsToShift].sort(
          (a, b) => (b.seatNumber || 0) - (a.seatNumber || 0)
        )

        for (const item of sortedItems) {
          await tx.orderItem.update({
            where: { id: item.id },
            data: { seatNumber: (item.seatNumber || 0) + 1 },
          })
        }

        // Shift timestamps
        const newTimestamps: SeatTimestamps = {}
        for (const [seatStr, timestamp] of Object.entries(seatTimestamps)) {
          const seatNum = parseInt(seatStr, 10)
          if (seatNum >= position) {
            newTimestamps[(seatNum + 1).toString()] = timestamp
          } else {
            newTimestamps[seatStr] = timestamp
          }
        }
        // Add timestamp for new seat
        newTimestamps[position.toString()] = new Date().toISOString()

        const newTotalSeats = currentTotalSeats + seatsToAdd

        // Update order
        const updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: {
            extraSeatCount: order.extraSeatCount + seatsToAdd,
            guestCount: newTotalSeats,
            seatVersion: order.seatVersion + 1,
            seatTimestamps: newTimestamps,
          },
        })

        return {
          action: 'INSERT',
          position,
          newTotalSeats,
          seatVersion: updatedOrder.seatVersion,
          itemsShifted: itemsToShift.length,
        }

      } else if (action === 'REMOVE') {
        // Validate position for remove
        if (position > currentTotalSeats) {
          throw new Error(`Cannot remove position ${position}. Current seats: ${currentTotalSeats}`)
        }

        // Minimum 1 seat
        if (currentTotalSeats <= 1) {
          throw new Error('Cannot remove the last seat')
        }

        // Move items from removed seat to "Shared" (seatNumber = null)
        const itemsOnRemovedSeat = order.items.filter(
          item => item.seatNumber === position
        )

        for (const item of itemsOnRemovedSeat) {
          await tx.orderItem.update({
            where: { id: item.id },
            data: { seatNumber: null },
          })
        }

        // Shift all items with seatNumber > position down by 1
        const itemsToShift = order.items.filter(
          item => item.seatNumber && item.seatNumber > position
        )

        // Update items in ascending order
        const sortedItems = [...itemsToShift].sort(
          (a, b) => (a.seatNumber || 0) - (b.seatNumber || 0)
        )

        for (const item of sortedItems) {
          await tx.orderItem.update({
            where: { id: item.id },
            data: { seatNumber: (item.seatNumber || 0) - 1 },
          })
        }

        // Shift timestamps
        const newTimestamps: SeatTimestamps = {}
        for (const [seatStr, timestamp] of Object.entries(seatTimestamps)) {
          const seatNum = parseInt(seatStr, 10)
          if (seatNum === position) {
            // Remove this timestamp
            continue
          } else if (seatNum > position) {
            newTimestamps[(seatNum - 1).toString()] = timestamp
          } else {
            newTimestamps[seatStr] = timestamp
          }
        }

        // Update order
        const updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: {
            extraSeatCount: order.extraSeatCount - 1,
            guestCount: currentTotalSeats - 1,
            seatVersion: order.seatVersion + 1,
            seatTimestamps: newTimestamps,
          },
        })

        return {
          action: 'REMOVE',
          position,
          newTotalSeats: currentTotalSeats - 1,
          seatVersion: updatedOrder.seatVersion,
          itemsMovedToShared: itemsOnRemovedSeat.length,
          itemsShifted: itemsToShift.length,
        }

      } else {
        throw new Error(`Unknown action: ${action}`)
      }
    })

    return NextResponse.json(result)

  } catch (error) {
    console.error('Failed to modify seating:', error)
    const message = error instanceof Error ? error.message : 'Failed to modify seating'
    const status = message === 'Order not found' ? 404 :
                   message.includes('has changed') ? 409 :
                   message.includes('Cannot') ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
