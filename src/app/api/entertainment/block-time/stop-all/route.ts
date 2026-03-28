import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { OrderRepository } from '@/lib/repositories'
import { dispatchFloorPlanUpdate, dispatchEntertainmentStatusChanged, dispatchEntertainmentUpdate, dispatchOrderTotalsUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { err, ok } from '@/lib/api-response'

import { stopAllSessions } from '@/lib/domain/entertainment'
import { recalculateOrderTotals } from '@/lib/domain/order-items'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('entertainment-stop-all')

// POST - Force-stop all active entertainment sessions (closing time)
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, reason, employeeId } = body
    const stopReason = reason || 'closing_time'

    if (!locationId) {
      return err('Location ID is required')
    }

    // Permission check — force-stop-all requires entertainment permission
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_ENTERTAINMENT)
    if (!auth.authorized) return err(auth.error, auth.status)

    const now = new Date()

    // TODO: Migrate to MenuItemRepository once it supports findMany with custom select.
    // Find all active entertainment sessions at this location.
    const activeMenuItems = await db.menuItem.findMany({
      where: {
        locationId,
        entertainmentStatus: 'in_use',
        currentOrderItemId: { not: null },
        deletedAt: null,
      },
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
        overtimeEnabled: true,
        overtimeMode: true,
        overtimeMultiplier: true,
        overtimePerMinuteRate: true,
        overtimeFlatFee: true,
        overtimeGraceMinutes: true,
        currentOrderItemId: true,
        currentOrderId: true,
      },
    })

    if (activeMenuItems.length === 0) {
      return ok({
        success: true,
        sessionsStopped: 0,
        totalCharges: 0,
        waitlistCancelled: 0,
        message: 'No active entertainment sessions to stop.',
      })
    }

    // Collect order item IDs to fetch them all at once
    const orderItemIds = activeMenuItems.map(mi => mi.currentOrderItemId!).filter(Boolean)

    // TODO: Migrate to OrderItemRepository.getItemsByIdsWithInclude once it supports order join.
    const orderItems = await db.orderItem.findMany({
      where: { id: { in: orderItemIds }, locationId },
      include: {
        order: {
          select: {
            id: true,
            locationId: true,
          },
        },
      },
    })

    // Map orderItemId -> orderItem for quick lookup
    const orderItemMap = new Map(orderItems.map(oi => [oi.id, oi]))

    // Process all sessions in a single transaction for atomicity
    const txResult = await db.$transaction(async (tx) => {
      return stopAllSessions(tx, {
        locationId,
        now,
        activeMenuItems,
        orderItemMap,
      })
    })

    const totalCharges = txResult.results.reduce((sum, r) => sum + r.charge, 0)

    // Push DB changes upstream to Neon (fire-and-forget)
    pushUpstream()

    // Fire-and-forget: recalculate full order totals (subtotal, tax, total) for each affected order
    const affectedOrderIds = [...new Set(txResult.results.map(r => r.orderId))]
    for (const orderId of affectedOrderIds) {
      void (async () => {
        try {
          const order = await OrderRepository.getOrderByIdWithInclude(
            orderId,
            locationId,
            { location: { select: { settings: true } } },
          )
          if (!order) return
          const totals = await recalculateOrderTotals(
            db, orderId, (order as any).location.settings,
            Number(order.tipTotal) || 0, order.isTaxExempt
          )
          await OrderRepository.updateOrder(orderId, locationId, {
            subtotal: totals.subtotal,
            taxTotal: totals.taxTotal,
            taxFromInclusive: totals.taxFromInclusive,
            taxFromExclusive: totals.taxFromExclusive,
            total: totals.total,
            commissionTotal: totals.commissionTotal,
            itemCount: totals.itemCount,
          })
          void dispatchOrderTotalsUpdate(locationId, orderId, {
            subtotal: totals.subtotal,
            taxTotal: totals.taxTotal,
            tipTotal: Number(order.tipTotal) || 0,
            discountTotal: 0,
            total: totals.total,
            commissionTotal: totals.commissionTotal,
          }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
        } catch (err) {
          console.error(`[stop-all] Failed to recalculate order totals for order ${orderId}:`, err)
        }
      })()
    }

    // Fire-and-forget: emit order events for each stopped session
    for (const r of txResult.results) {
      void emitOrderEvent(locationId, r.orderId, 'ITEM_UPDATED', {
        lineItemId: r.orderItemId,
        price: r.charge,
        blockTimeStartedAt: 'CLEARED',
        blockTimeExpiresAt: now.toISOString(),
        actualMinutesUsed: r.actualMinutes,
        reason: stopReason,
        forceStopAll: true,
      })

      // Dispatch entertainment status changed for each item
      void dispatchEntertainmentStatusChanged(locationId, {
        itemId: r.menuItemId,
        entertainmentStatus: 'available',
        currentOrderId: null,
        expiresAt: null,
      }, { async: true }).catch(err => log.warn({ err }, 'Socket dispatch failed'))

      // Emit session update for KDS Pit Boss + Android timers
      void dispatchEntertainmentUpdate(locationId, {
        sessionId: r.orderItemId,
        tableId: r.menuItemId,
        tableName: r.menuItemName,
        action: 'force_stopped',
        expiresAt: null,
        startedAt: null,
      }, { async: true }).catch(err => log.warn({ err }, 'Socket dispatch failed'))
    }

    // Dispatch floor plan update once (covers all elements)
    dispatchFloorPlanUpdate(locationId, { async: true })

    // Audit trail: force stop all
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'entertainment_force_stop_all',
        entityType: 'location',
        entityId: locationId,
        details: {
          reason: stopReason,
          sessionsStopped: txResult.results.length,
          totalCharges,
          waitlistCancelled: txResult.waitlistCancelled,
          sessions: txResult.results.map(r => ({
            menuItemName: r.menuItemName,
            actualMinutes: r.actualMinutes,
            charge: r.charge,
          })),
          employeeName: auth.employee.displayName || `${auth.employee.firstName} ${auth.employee.lastName}`,
        },
      },
    }).catch(err => console.error('[entertainment] Audit log failed:', err))

    return ok({
      success: true,
      sessionsStopped: txResult.results.length,
      totalCharges,
      waitlistCancelled: txResult.waitlistCancelled,
      sessions: txResult.results.map(r => ({
        menuItemName: r.menuItemName,
        actualMinutes: r.actualMinutes,
        charge: r.charge,
      })),
      message: `Stopped ${txResult.results.length} session${txResult.results.length !== 1 ? 's' : ''}. Total charges: $${totalCharges.toFixed(2)}. ${txResult.waitlistCancelled} waitlist ${txResult.waitlistCancelled !== 1 ? 'entries' : 'entry'} cancelled.`,
    })
  } catch (error) {
    console.error('Failed to force-stop all sessions:', error)
    return err('Failed to force-stop all sessions', 500)
  }
})
