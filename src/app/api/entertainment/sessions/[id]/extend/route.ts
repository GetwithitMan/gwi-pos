import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderItemRepository } from '@/lib/repositories'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { err, ok, notFound } from '@/lib/api-response'
import { createChildLogger } from '@/lib/logger'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { dispatchEntertainmentUpdate, dispatchEntertainmentStatusChanged } from '@/lib/socket-dispatch'
import {
  validateExtendRequest,
  validateExtension,
  extendSession,
} from '@/lib/domain/entertainment'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

const log = createChildLogger('entertainment-sessions-extend')

/**
 * POST /api/entertainment/sessions/[id]/extend
 *
 * Extend a session by additional minutes.
 * Body: { additionalMinutes, employeeId, locationId }
 * Returns: new expiry time, updated estimated charge
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderItemId } = await params
    if (!orderItemId) return err('Session ID is required', 400)

    const body = await request.json()
    const { additionalMinutes, employeeId, locationId } = body

    if (!additionalMinutes || additionalMinutes <= 0) {
      return err('additionalMinutes must be a positive number', 400)
    }

    // Permission check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_ENTERTAINMENT)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Fetch the order item with pricing config
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
          locationId: true,
          status: true,
        },
      },
    })

    if (!orderItem) {
      return notFound('Order item not found')
    }

    // Validate extension
    const extendError = validateExtension({
      orderLocationId: orderItem.order.locationId,
      requestLocationId: locationId,
      orderStatus: orderItem.order.status,
      hasActiveBlockTime: !!orderItem.blockTimeExpiresAt,
    })
    if (extendError) {
      return err(extendError, extendError === 'Location ID mismatch' ? 403 : 400)
    }

    // Extend the session in a transaction
    const txResult = await db.$transaction(async (tx) => {
      return extendSession(tx, {
        orderItemId,
        menuItemId: orderItem.menuItemId,
        additionalMinutes,
        menuItem: orderItem.menuItem as any,
      })
    })

    if ('error' in txResult) {
      return err(txResult.error, 400)
    }

    const { updatedItem, newExpiresAt, newTotalMinutes, newPrice } = txResult

    // Fire-and-forget: sync to cloud
    void notifyDataChanged({ locationId, domain: 'events', action: 'updated', entityId: orderItemId })
    void pushUpstream()

    // Fire-and-forget: emit order event
    void emitOrderEvent(orderItem.order.locationId, orderItem.order.id, 'ITEM_UPDATED', {
      lineItemId: orderItemId,
      price: newPrice,
      blockTimeMinutes: newTotalMinutes,
      blockTimeExpiresAt: newExpiresAt.toISOString(),
    })

    // Fire-and-forget: socket updates
    void dispatchEntertainmentStatusChanged(orderItem.order.locationId, {
      itemId: orderItem.menuItemId,
      entertainmentStatus: 'in_use',
      currentOrderId: orderItem.orderId,
      expiresAt: newExpiresAt.toISOString(),
    }, { async: true }).catch(err => log.warn({ err }, 'Socket dispatch failed'))

    void dispatchEntertainmentUpdate(orderItem.order.locationId, {
      sessionId: orderItemId,
      tableId: orderItem.menuItemId,
      tableName: updatedItem.name || '',
      action: 'extended',
      expiresAt: newExpiresAt.toISOString(),
      startedAt: updatedItem.blockTimeStartedAt?.toISOString() ?? null,
      addedMinutes: additionalMinutes,
    }, { async: true }).catch(err => log.warn({ err }, 'Socket dispatch failed'))

    // Audit log
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'entertainment_session_extended',
        entityType: 'order_item',
        entityId: orderItemId,
        details: {
          menuItemId: orderItem.menuItemId,
          itemName: orderItem.menuItem.name,
          additionalMinutes,
          newTotalMinutes,
          newPrice,
          newExpiresAt: newExpiresAt.toISOString(),
          orderId: orderItem.orderId,
        },
      },
    }).catch(err => console.error('[entertainment-sessions] Audit log failed:', err))

    return ok({
      success: true,
      session: {
        sessionId: orderItemId,
        sessionName: updatedItem.name,
        bookedMinutes: newTotalMinutes,
        charge: newPrice,
        expiresAt: newExpiresAt.toISOString(),
        startedAt: updatedItem.blockTimeStartedAt?.toISOString(),
      },
      addedMinutes: additionalMinutes,
      message: `Extended by ${additionalMinutes} minutes. New expiry: ${newExpiresAt.toLocaleTimeString()}. Charge: $${newPrice.toFixed(2)}`,
    })
  } catch (error) {
    console.error('[entertainment-sessions-extend] Error:', error)
    return err('Failed to extend session', 500)
  }
})
