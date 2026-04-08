/**
 * GET /api/entertainment/active-sessions
 *
 * Returns all active timed rental sessions with real-time calculated charges.
 * Used by Android/mobile clients as a fallback when socket events aren't reliable.
 *
 * Query params:
 *   locationId (required): Location ID to fetch sessions for
 *
 * Response:
 * {
 *   "data": {
 *     "sessions": [
 *       {
 *         "orderId": "xxx",
 *         "orderItemId": "yyy",
 *         "menuItemId": "zzz",
 *         "menuItemName": "Bowling Lane 1",
 *         "currentCharge": 4500,  // cents
 *         "elapsedMinutes": 45,
 *         "isOvertime": false,
 *         "nextIncrementAt": "2026-04-08T23:45:00Z"
 *       }
 *     ],
 *     "serverTime": "2026-04-08T23:00:00Z"
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { calculateCharge, type EntertainmentPricing } from '@/lib/entertainment-pricing'
import { toNumber } from '@/lib/pricing'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

// Force dynamic rendering
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('Location ID is required')
    }

    const now = new Date()

    // Query all in_use timed rental items with linked order items
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
        name: true,
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
      return ok({
        sessions: [],
        serverTime: now.toISOString(),
      })
    }

    // Batch-fetch order items for timing
    const orderItemIds = inUseItems
      .map((item) => item.currentOrderItemId)
      .filter((id): id is string => id != null)

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

    // Build response with calculated charges
    const sessions = []

    for (const item of inUseItems) {
      if (!item.currentOrderItemId) continue

      const orderItem = orderItemMap.get(item.currentOrderItemId)
      if (!orderItem?.blockTimeStartedAt) continue

      const ratePerMinute = item.ratePerMinute ? toNumber(item.ratePerMinute) : 0
      if (ratePerMinute <= 0) continue

      try {
        const elapsedMinutes = Math.max(1, Math.ceil((now.getTime() - orderItem.blockTimeStartedAt.getTime()) / 60000))

        const pricing: EntertainmentPricing = {
          ratePerMinute,
          minimumCharge: item.minimumCharge ? toNumber(item.minimumCharge) : 0,
          incrementMinutes: item.incrementMinutes ?? 15,
          graceMinutes: item.graceMinutes ?? 5,
          overtime: item.overtimeEnabled
            ? {
                enabled: true,
                mode: (item.overtimeMode as any) || 'multiplier',
                multiplier: item.overtimeMultiplier ? toNumber(item.overtimeMultiplier) : undefined,
                perMinuteRate: item.overtimePerMinuteRate ? toNumber(item.overtimePerMinuteRate) : undefined,
                flatFee: item.overtimeFlatFee ? toNumber(item.overtimeFlatFee) : undefined,
                graceMinutes: item.overtimeGraceMinutes ?? undefined,
              }
            : undefined,
        }

        const breakdown = calculateCharge(elapsedMinutes, pricing, item.blockTimeMinutes ?? undefined)
        const chargeInCents = Math.round(breakdown.totalCharge * 100)

        // Calculate next increment boundary
        const minutesCovered = pricing.minimumCharge / pricing.ratePerMinute
        let nextBoundaryMs: number

        if (elapsedMinutes <= minutesCovered) {
          nextBoundaryMs = Math.ceil((minutesCovered - elapsedMinutes) * 60000)
        } else {
          const overageMinutes = elapsedMinutes - minutesCovered
          const chargeableOverage = Math.max(0, overageMinutes - pricing.graceMinutes)
          const currentIncrement = Math.floor(chargeableOverage / pricing.incrementMinutes)
          const minutesToNextBoundary =
            minutesCovered +
            pricing.graceMinutes +
            (currentIncrement + 1) * pricing.incrementMinutes -
            elapsedMinutes
          nextBoundaryMs = Math.max(0, Math.ceil(minutesToNextBoundary * 60000))
        }

        const nextIncrementAt = new Date(orderItem.blockTimeStartedAt.getTime() + elapsedMinutes * 60000 + nextBoundaryMs)

        sessions.push({
          orderId: item.currentOrderId,
          orderItemId: item.currentOrderItemId,
          menuItemId: item.id,
          menuItemName: item.name,
          currentCharge: chargeInCents,
          elapsedMinutes,
          isOvertime: breakdown.overtimeMinutes > 0,
          nextIncrementAt: nextIncrementAt.toISOString(),
        })
      } catch (calcErr) {
        // Log but don't fail entire response — skip this item
        console.warn('[entertainment/active-sessions] Failed to calculate charge for item:', item.id, calcErr)
      }
    }

    return ok({
      sessions,
      serverTime: now.toISOString(),
    })
  } catch (error) {
    console.error('[entertainment/active-sessions] Failed:', error)
    return err('Failed to fetch active entertainment sessions', 500)
  }
})
