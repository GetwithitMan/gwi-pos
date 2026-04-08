import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderItemRepository, OrderRepository } from '@/lib/repositories'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { err, ok } from '@/lib/api-response'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('entertainment-sessions')

/**
 * GET /api/entertainment/sessions
 *
 * List all active entertainment sessions at this location, sorted by urgency.
 * Returns: array of active sessions with currentCharge, elapsedMinutes, orderInfo, customerName
 * Sorted by: closest to expiry first, then oldest
 * Performance: single query, no N+1
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    if (!locationId) return err('Location ID is required', 400)

    // Verify venue access via withVenue middleware (already done)

    const now = new Date()

    // Single query fetches all active entertainment sessions with all needed fields
    const activeSessions = await db.orderItem.findMany({
      where: {
        deletedAt: null,
        blockTimeStartedAt: { not: null },
        blockTimeExpiresAt: { not: null },
        order: {
          locationId,
          deletedAt: null,
          status: { in: ['open', 'in_progress'] }, // Skip paid/closed orders
        },
      },
      select: {
        id: true,
        name: true,
        price: true,
        blockTimeStartedAt: true,
        blockTimeExpiresAt: true,
        blockTimeMinutes: true,
        orderId: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            tabName: true,
          },
        },
      },
    })

    // Transform to Android-friendly format with calculated fields
    const sessions = activeSessions.map((item) => {
      const startedAt = item.blockTimeStartedAt!
      const expiresAt = item.blockTimeExpiresAt!
      const elapsedMs = now.getTime() - startedAt.getTime()
      const elapsedMinutes = Math.max(0, Math.ceil(elapsedMs / (1000 * 60)))
      const timeRemainingMs = expiresAt.getTime() - now.getTime()
      const timeRemainingMinutes = Math.max(0, Math.ceil(timeRemainingMs / (1000 * 60)))
      const isExpired = now >= expiresAt
      const percentComplete = item.blockTimeMinutes
        ? Math.min(100, Math.round((elapsedMinutes / item.blockTimeMinutes) * 100))
        : 0

      return {
        sessionId: item.id,
        sessionName: item.name,
        orderId: item.orderId,
        orderNumber: item.order.orderNumber,
        customerName: item.order.tabName || 'Unknown',
        currentCharge: Number(item.price),
        elapsedMinutes,
        bookedMinutes: item.blockTimeMinutes || 0,
        timeRemainingMinutes,
        isExpired,
        percentComplete,
        startedAt: startedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        urgencyScore: timeRemainingMinutes, // Lower = more urgent
      }
    })

    // Sort by urgency: expiring soon first, then oldest
    sessions.sort((a, b) => {
      if (a.isExpired && !b.isExpired) return -1 // Expired first
      if (!a.isExpired && b.isExpired) return 1
      return a.timeRemainingMinutes - b.timeRemainingMinutes
    })

    return ok({
      sessions,
      locationId,
      timestamp: now.toISOString(),
      activeCount: sessions.length,
    })
  } catch (error) {
    console.error('[entertainment-sessions GET] Error:', error)
    return err('Failed to fetch sessions', 500)
  }
})
