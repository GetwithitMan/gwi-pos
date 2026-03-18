/**
 * Stale Order Cleanup Service
 *
 * Extracted from the route handler so that both the API endpoint
 * and the server.ts schedulers can call it without localhost HTTP.
 */

import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import { emitOrderEvent } from '@/lib/order-events/emitter'

export interface CleanupResult {
  closedCount: number
  cutoffTime: string
  orderIds: string[]
}

export interface CleanupOptions {
  locationId: string
  maxAgeHours?: number
  dryRun?: boolean
}

/**
 * Find and cancel stale $0 draft orders older than the given threshold.
 *
 * @returns The count and IDs of cancelled orders
 */
export async function cleanupStaleOrders(opts: CleanupOptions): Promise<CleanupResult> {
  const { locationId, maxAgeHours = 4, dryRun = false } = opts

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

  // Filter to only truly empty orders (0 items)
  const emptyStaleOrders = staleOrders.filter(o => o.itemCount === 0)

  if (dryRun || emptyStaleOrders.length === 0) {
    return {
      closedCount: emptyStaleOrders.length,
      cutoffTime: cutoff.toISOString(),
      orderIds: emptyStaleOrders.map(o => o.id),
    }
  }

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

  return {
    closedCount: result.count,
    cutoffTime: cutoff.toISOString(),
    orderIds: ids,
  }
}
