import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderItemRepository } from '@/lib/repositories'
import { withVenue } from '@/lib/with-venue'
import { err, ok, notFound } from '@/lib/api-response'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('entertainment-sessions-detail')

/**
 * GET /api/entertainment/sessions/[id]
 *
 * Get detailed information about a specific session.
 * Returns: full session info including real-time calculated charge
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderItemId } = await params
    if (!orderItemId) return err('Session ID is required', 400)

    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    if (!locationId) return err('Location ID is required', 400)

    // Fetch the order item with all session details
    const orderItem = await OrderItemRepository.getItemByIdWithInclude(orderItemId, locationId, {
      menuItem: {
        select: {
          id: true,
          name: true,
          price: true,
          timedPricing: true,
          ratePerMinute: true,
          minimumCharge: true,
          incrementMinutes: true,
          graceMinutes: true,
          blockTimeMinutes: true,
          happyHourEnabled: true,
          happyHourDiscount: true,
          happyHourStart: true,
          happyHourEnd: true,
          happyHourDays: true,
          prepaidPackages: true,
          overtimeEnabled: true,
          overtimeMode: true,
          overtimeMultiplier: true,
          overtimePerMinuteRate: true,
          overtimeFlatFee: true,
          overtimeGraceMinutes: true,
        },
      },
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          tableName: true,
          tabName: true,
          locationId: true,
        },
      },
    })

    if (!orderItem) {
      return notFound('Session not found')
    }

    // Verify location access
    if (orderItem.order.locationId !== locationId) {
      return err('Location ID mismatch', 403)
    }

    // Calculate real-time metrics
    const now = new Date()
    const startedAt = orderItem.blockTimeStartedAt
    const expiresAt = orderItem.blockTimeExpiresAt

    if (!startedAt || !expiresAt) {
      return err('Session is not active', 400)
    }

    const elapsedMs = now.getTime() - startedAt.getTime()
    const elapsedMinutes = Math.max(0, Math.ceil(elapsedMs / (1000 * 60)))
    const timeRemainingMs = expiresAt.getTime() - now.getTime()
    const timeRemainingMinutes = Math.max(0, Math.ceil(timeRemainingMs / (1000 * 60)))
    const isExpired = now >= expiresAt
    const percentComplete = orderItem.blockTimeMinutes
      ? Math.min(100, Math.round((elapsedMinutes / orderItem.blockTimeMinutes) * 100))
      : 0

    return ok({
      session: {
        sessionId: orderItem.id,
        sessionName: orderItem.name,
        orderId: orderItem.orderId,
        orderNumber: orderItem.order.orderNumber,
        customerName: orderItem.order.tabName || orderItem.order.tableName || 'Unknown',
        menuItemId: orderItem.menuItemId,
        menuItemName: orderItem.menuItem.name,
        currentCharge: Number(orderItem.price),
        bookedMinutes: orderItem.blockTimeMinutes || 0,
        elapsedMinutes,
        timeRemainingMinutes,
        isExpired,
        percentComplete,
        startedAt: startedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        pricingConfig: {
          ratePerMinute: orderItem.menuItem.ratePerMinute,
          minimumCharge: orderItem.menuItem.minimumCharge,
          incrementMinutes: orderItem.menuItem.incrementMinutes,
          graceMinutes: orderItem.menuItem.graceMinutes,
          overtimeEnabled: orderItem.menuItem.overtimeEnabled,
          overtimeMode: orderItem.menuItem.overtimeMode,
        },
      },
      timestamp: now.toISOString(),
    })
  } catch (error) {
    console.error('[entertainment-sessions-detail] Error:', error)
    return err('Failed to fetch session details', 500)
  }
})
