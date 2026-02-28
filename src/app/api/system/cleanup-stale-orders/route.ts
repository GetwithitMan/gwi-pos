import { NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import { emitOrderEvent } from '@/lib/order-events/emitter'

/**
 * POST /api/system/cleanup-stale-orders
 *
 * Closes all $0 draft orders older than 4 hours.
 * These are orphaned orders from draft pre-creation that were never used.
 *
 * Callable manually (admin action) or by the 4 AM EOD cron.
 *
 * Query params:
 *   locationId (required) — the location to clean up
 *   maxAgeHours (optional) — override the default 4-hour threshold
 *   dryRun (optional) — if "true", returns count without closing
 */
export const POST = withVenue(async (request) => {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const maxAgeHours = parseInt(searchParams.get('maxAgeHours') || '4', 10)
    const dryRun = searchParams.get('dryRun') === 'true'

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    if (isNaN(maxAgeHours) || maxAgeHours < 1) {
      return NextResponse.json({ error: 'maxAgeHours must be a positive integer' }, { status: 400 })
    }

    // Calculate the cutoff time
    const cutoff = new Date()
    cutoff.setHours(cutoff.getHours() - maxAgeHours)

    // Find stale draft orders: status='draft' or 'open', total=$0, no items sent, older than cutoff
    // Read from OrderSnapshot (event-sourced projection) — cents-based fields
    const staleOrders = await db.orderSnapshot.findMany({
      where: {
        locationId,
        status: { in: ['draft', 'open'] },
        totalCents: 0,
        subtotalCents: 0,
        sentAt: null,
        paidAmountCents: 0,
        createdAt: { lt: cutoff },
        deletedAt: null,
      },
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        itemCount: true,
      },
    })

    // Filter to only truly empty orders (0 items) to avoid closing orders
    // that have items but happen to have $0 total (e.g., comped orders)
    const emptyStaleOrders = staleOrders.filter(o => o.itemCount === 0)

    if (dryRun) {
      return NextResponse.json({
        data: {
          dryRun: true,
          staleOrderCount: emptyStaleOrders.length,
          cutoffTime: cutoff.toISOString(),
          orders: emptyStaleOrders.map(o => ({
            id: o.id,
            orderNumber: o.orderNumber,
            createdAt: o.createdAt.toISOString(),
          })),
        },
      })
    }

    if (emptyStaleOrders.length === 0) {
      return NextResponse.json({
        data: { closedCount: 0, message: 'No stale orders found' },
      })
    }

    // Close all stale orders in a single batch update
    const now = new Date()
    const ids = emptyStaleOrders.map(o => o.id)

    const result = await db.order.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'cancelled',
        closedAt: now,
        deletedAt: now,
        notes: `Auto-cancelled: stale $0 draft (older than ${maxAgeHours}h)`,
      },
    })

    logger.log(`[cleanup-stale-orders] Closed ${result.count} stale draft orders for location ${locationId}`)

    // Emit ORDER_CLOSED events for each cancelled order (fire-and-forget)
    for (const id of ids) {
      void emitOrderEvent(locationId, id, 'ORDER_CLOSED', {
        closedStatus: 'cancelled',
        reason: `Auto-cancelled: stale $0 draft (older than ${maxAgeHours}h)`,
      })
    }

    return NextResponse.json({
      data: {
        closedCount: result.count,
        cutoffTime: cutoff.toISOString(),
        orderIds: ids,
      },
    })
  } catch (error) {
    logger.error('[cleanup-stale-orders] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
})
