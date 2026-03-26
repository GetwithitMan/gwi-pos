/**
 * Walkout Auto-Detection
 *
 * Scans for orders that have been open beyond a configurable threshold
 * where the assigned table is now available/empty and no payments exist.
 * Flags them as potential walkouts for manager review — does NOT auto-close
 * or auto-mark-walkout.
 */

import { createChildLogger } from '@/lib/logger'
import { db } from '@/lib/db'
import { parseSettings, DEFAULT_WALKOUT_SETTINGS } from '@/lib/settings'
import { OrderRepository } from '@/lib/repositories'
import { emitToLocation } from '@/lib/socket-server'
import { dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'

const log = createChildLogger('walkout-detector')

/**
 * Detect potential walkouts for a location.
 *
 * Criteria:
 * - Order status is 'open' or 'in_progress'
 * - Order was created more than threshold minutes ago
 * - Order has a table assigned, and that table is currently 'available'
 * - Order has zero payments
 * - Order is not already marked as a walkout
 * - Order notes do not already contain [POTENTIAL WALKOUT]
 *
 * For each match:
 * - Updates order notes with "[POTENTIAL WALKOUT]" prefix
 * - Creates an audit log entry
 * - Emits socket event for real-time manager alert
 */
export async function detectPotentialWalkouts(locationId: string): Promise<{
  flaggedCount: number
  flaggedOrders: { id: string; orderNumber: number; tableName: string | null; minutesOpen: number }[]
}> {
  // Load location settings
  const location = await db.location.findFirst({
    where: { id: locationId },
    select: { settings: true },
  })

  if (!location) {
    log.warn({ locationId }, 'Location not found')
    return { flaggedCount: 0, flaggedOrders: [] }
  }

  const settings = parseSettings(location.settings)
  const walkoutSettings = settings.walkout ?? DEFAULT_WALKOUT_SETTINGS

  if (!walkoutSettings.autoDetectEnabled) {
    return { flaggedCount: 0, flaggedOrders: [] }
  }

  const thresholdMinutes = walkoutSettings.autoDetectMinutes
  const cutoffTime = new Date(Date.now() - thresholdMinutes * 60 * 1000)

  // Find open orders that are older than the threshold, have a table, and no payments
  const suspectOrders = await db.order.findMany({
    where: {
      locationId,
      deletedAt: null,
      status: { in: ['open', 'in_progress'] },
      isWalkout: false,
      createdAt: { lt: cutoffTime },
      tableId: { not: null },
      payments: {
        none: {},
      },
    },
    select: {
      id: true,
      orderNumber: true,
      notes: true,
      createdAt: true,
      tableId: true,
      table: {
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
    },
  })

  // Filter: only flag if the table is currently available (empty)
  const walkoutCandidates = suspectOrders.filter(order => {
    if (!order.table) return false
    if (order.table.status !== 'available') return false
    // Skip if already flagged
    if (order.notes?.includes('[POTENTIAL WALKOUT]')) return false
    return true
  })

  if (walkoutCandidates.length === 0) {
    return { flaggedCount: 0, flaggedOrders: [] }
  }

  const now = new Date()
  const flaggedOrders: { id: string; orderNumber: number; tableName: string | null; minutesOpen: number }[] = []

  // Flag each candidate
  for (const order of walkoutCandidates) {
    const minutesOpen = Math.round((now.getTime() - order.createdAt.getTime()) / (60 * 1000))
    const flagPrefix = `[POTENTIAL WALKOUT] Flagged at ${now.toISOString()} — open ${minutesOpen}min, table ${order.table!.name} now available.`
    const updatedNotes = order.notes
      ? `${flagPrefix}\n${order.notes}`
      : flagPrefix

    await OrderRepository.updateOrder(order.id, locationId, { notes: updatedNotes })

    // Create audit log
    await db.auditLog.create({
      data: {
        locationId,
        action: 'walkout_auto_detected',
        entityType: 'order',
        entityId: order.id,
        details: {
          orderNumber: order.orderNumber,
          tableName: order.table!.name,
          minutesOpen,
          threshold: thresholdMinutes,
          message: `Order #${order.orderNumber} flagged as potential walkout — open for ${minutesOpen} minutes, table ${order.table!.name} is now available`,
        },
      },
    })

    // Fire-and-forget: emit WALKOUT_MARKED event for event-sourced sync
    void emitOrderEvent(locationId, order.id, 'WALKOUT_MARKED', {
      reason: 'walkout_detector',
      employeeId: null,
    }).catch(err => log.error({ err }, 'Failed to emit WALKOUT_MARKED'))

    flaggedOrders.push({
      id: order.id,
      orderNumber: order.orderNumber,
      tableName: order.table!.name,
      minutesOpen,
    })
  }

  // Emit socket events for real-time manager alerts (fire-and-forget)
  void emitToLocation(locationId, 'walkout:potential-detected', {
    count: flaggedOrders.length,
    orders: flaggedOrders,
    timestamp: now.toISOString(),
  }).catch(err => log.error({ err }, 'Failed to emit walkout:potential-detected socket event'))

  // Dispatch open orders changed so terminals refresh their order lists
  void dispatchOpenOrdersChanged(locationId, {
    trigger: 'item_updated' as any,
  }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in walkout-detector'))

  log.info({ flaggedCount: flaggedOrders.length, locationId }, 'Flagged potential walkout(s)')

  return { flaggedCount: flaggedOrders.length, flaggedOrders }
}
