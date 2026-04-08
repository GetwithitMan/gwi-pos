/**
 * Entertainment Live Price Updater — periodic real-time charge calculation and dispatch
 *
 * Every 60 seconds, queries all active timed rental sessions and sends real-time
 * price updates to connected clients, replacing the stale flat-rate price shown
 * at order time.
 *
 * Process:
 * 1. Query all MenuItem with entertainmentStatus='in_use' AND currentOrderId IS NOT NULL
 * 2. For each, fetch MenuItem config (pricing, overtime) and OrderItem (blockTimeStartedAt, blockTimeMinutes)
 * 3. Calculate current charge using calculateCharge()
 * 4. Update OrderItem.price in DB (so order total queries return accurate numbers)
 * 5. Emit socket event to location room: entertainment:price-update
 * 6. Fire-and-forget (async dispatch, don't wait for clients to ack)
 */

import { db } from '@/lib/db'
import { calculateCharge, type EntertainmentPricing } from '@/lib/entertainment-pricing'
import { dispatchEntertainmentPriceBatchUpdate } from '@/lib/socket-dispatch'
import { toNumber } from '@/lib/pricing'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('entertainment-price-updater')

interface ActiveSession {
  menuItemId: string
  orderId: string
  orderItemId: string
  blockTimeStartedAt: Date
  blockTimeMinutes: number | null
  ratePerMinute: number
  minimumCharge: number
  incrementMinutes: number
  graceMinutes: number
  overtimeEnabled: boolean
  overtimeMode?: string
  overtimeMultiplier?: number
  overtimePerMinuteRate?: number
  overtimeFlatFee?: number
  overtimeGraceMinutes?: number
}

/**
 * Fetch all active timed rental sessions for a location
 */
async function getActiveTimedSessions(locationId: string): Promise<ActiveSession[]> {
  const now = new Date()

  // Query MenuItems that are in_use with a linked order
  const inUseItems = await db.menuItem.findMany({
    where: {
      locationId,
      deletedAt: null,
      isActive: true,
      itemType: 'timed_rental',
      entertainmentStatus: 'in_use',
      currentOrderId: { not: null },
    },
    select: {
      id: true,
      currentOrderId: true,
      currentOrderItemId: true,
      ratePerMinute: true,
      minimumCharge: true,
      incrementMinutes: true,
      graceMinutes: true,
      overtimeEnabled: true,
      overtimeMode: true,
      overtimeMultiplier: true,
      overtimePerMinuteRate: true,
      overtimeFlatFee: true,
      overtimeGraceMinutes: true,
      blockTimeMinutes: true,
    },
  })

  if (inUseItems.length === 0) {
    return []
  }

  // Batch-fetch order items for timing info
  const orderItemIds = inUseItems
    .map((item) => item.currentOrderItemId)
    .filter((id): id is string => id != null)

  if (orderItemIds.length === 0) {
    return []
  }

  const orderItems = await db.orderItem.findMany({
    where: {
      id: { in: orderItemIds },
      deletedAt: null,
    },
    select: {
      id: true,
      blockTimeStartedAt: true,
      blockTimeMinutes: true,
    },
  })

  const orderItemMap = new Map(orderItems.map((oi) => [oi.id, oi]))

  // Build session list, filtering to only items with valid timing
  const sessions: ActiveSession[] = []
  for (const item of inUseItems) {
    if (!item.currentOrderItemId) continue

    const orderItem = orderItemMap.get(item.currentOrderItemId)
    if (!orderItem?.blockTimeStartedAt) continue

    const ratePerMinute = item.ratePerMinute ? toNumber(item.ratePerMinute) : 0
    if (ratePerMinute <= 0) continue

    sessions.push({
      menuItemId: item.id,
      orderId: item.currentOrderId!,
      orderItemId: item.currentOrderItemId,
      blockTimeStartedAt: orderItem.blockTimeStartedAt,
      blockTimeMinutes: orderItem.blockTimeMinutes,
      ratePerMinute,
      minimumCharge: item.minimumCharge ? toNumber(item.minimumCharge) : 0,
      incrementMinutes: item.incrementMinutes ?? 15,
      graceMinutes: item.graceMinutes ?? 5,
      overtimeEnabled: item.overtimeEnabled ?? false,
      overtimeMode: item.overtimeMode ?? 'multiplier',
      overtimeMultiplier: item.overtimeMultiplier ? toNumber(item.overtimeMultiplier) : undefined,
      overtimePerMinuteRate: item.overtimePerMinuteRate ? toNumber(item.overtimePerMinuteRate) : undefined,
      overtimeFlatFee: item.overtimeFlatFee ? toNumber(item.overtimeFlatFee) : undefined,
      overtimeGraceMinutes: item.overtimeGraceMinutes ?? undefined,
    })
  }

  return sessions
}

/**
 * Calculate the next increment boundary for a session
 * (when the next charge tick will occur)
 */
function getNextIncrementAt(
  elapsedMinutes: number,
  pricing: EntertainmentPricing,
  startedAt: Date
): Date {
  const minutesCovered = pricing.minimumCharge / pricing.ratePerMinute
  const elapsedMs = elapsedMinutes * 60000

  let nextBoundary: number

  if (elapsedMinutes <= minutesCovered) {
    // Still in minimum period — next boundary is when minimum expires
    nextBoundary = Math.ceil((minutesCovered - elapsedMinutes) * 60000)
  } else {
    // In overage period — find next increment boundary
    const overageMinutes = elapsedMinutes - minutesCovered
    const chargeableOverage = Math.max(0, overageMinutes - pricing.graceMinutes)
    const currentIncrement = Math.floor(chargeableOverage / pricing.incrementMinutes)
    const minutesToNextBoundary =
      minutesCovered + pricing.graceMinutes + (currentIncrement + 1) * pricing.incrementMinutes - elapsedMinutes
    nextBoundary = Math.max(0, Math.ceil(minutesToNextBoundary * 60000))
  }

  return new Date(startedAt.getTime() + elapsedMs + nextBoundary)
}

/**
 * Run the periodic price updater for a location
 * Called every 60 seconds from server.ts
 */
export async function runEntertainmentPriceUpdate(locationId: string): Promise<void> {
  try {
    const sessions = await getActiveTimedSessions(locationId)

    if (sessions.length === 0) {
      return // No active sessions, nothing to do
    }

    const now = new Date()
    const updates: Promise<unknown>[] = []
    const batchSessionUpdates: Array<{
      orderId: string
      orderItemId: string
      menuItemId: string
      currentCharge: number
      elapsedMinutes: number
      isOvertime: boolean
      nextIncrementAt: string
    }> = []

    for (const session of sessions) {
      try {
        const elapsedMinutes = Math.max(1, Math.ceil((now.getTime() - session.blockTimeStartedAt.getTime()) / 60000))

        const pricing: EntertainmentPricing = {
          ratePerMinute: session.ratePerMinute,
          minimumCharge: session.minimumCharge,
          incrementMinutes: session.incrementMinutes,
          graceMinutes: session.graceMinutes,
          overtime: session.overtimeEnabled
            ? {
                enabled: true,
                mode: (session.overtimeMode as any) || 'multiplier',
                multiplier: session.overtimeMultiplier,
                perMinuteRate: session.overtimePerMinuteRate,
                flatFee: session.overtimeFlatFee,
                graceMinutes: session.overtimeGraceMinutes,
              }
            : undefined,
        }

        const breakdown = calculateCharge(elapsedMinutes, pricing, session.blockTimeMinutes ?? undefined)
        const settledPrice = breakdown.totalCharge
        const chargeInCents = Math.round(settledPrice * 100)
        const nextIncrementAt = getNextIncrementAt(elapsedMinutes, pricing, session.blockTimeStartedAt)

        // Queue DB update (don't await yet — batch them all)
        updates.push(
          db.orderItem.update({
            where: { id: session.orderItemId },
            data: {
              price: settledPrice,
              itemTotal: settledPrice * 1, // quantity=1 assumption (multiply by actual qty if needed)
            },
            select: { id: true }, // Minimal return to reduce payload
          })
        )

        // Collect session update for batch dispatch
        batchSessionUpdates.push({
          orderId: session.orderId,
          orderItemId: session.orderItemId,
          menuItemId: session.menuItemId,
          currentCharge: chargeInCents,
          elapsedMinutes,
          isOvertime: breakdown.overtimeMinutes > 0,
          nextIncrementAt: nextIncrementAt.toISOString(),
        })
      } catch (err) {
        log.warn({ err, menuItemId: session.menuItemId }, 'Failed to calculate price for session')
      }
    }

    // Execute all DB updates in parallel
    if (updates.length > 0) {
      try {
        await Promise.all(updates)
      } catch (err) {
        log.warn({ err }, 'Some order item price updates failed')
      }
    }

    // Dispatch a single batch event with all session updates instead of N individual events
    if (batchSessionUpdates.length > 0) {
      dispatchEntertainmentPriceBatchUpdate(
        locationId,
        { sessions: batchSessionUpdates },
        { async: true }
      ).catch((err) => {
        log.warn({ err }, 'Failed to dispatch batch price update')
      })
    }
  } catch (err) {
    log.error({ err, locationId }, 'Entertainment price updater failed')
  }
}
