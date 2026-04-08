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
  validateStopRequest,
  validateStopSession,
  stopSession,
} from '@/lib/domain/entertainment'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'

const log = createChildLogger('entertainment-sessions-stop')

/**
 * POST /api/entertainment/sessions/[id]/stop
 *
 * Stop a session immediately.
 * Query params: reason=normal|comp|void|force (optional, defaults to normal)
 * Returns: final charge, elapsed time, breakdown
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderItemId } = await params
    if (!orderItemId) return err('Session ID is required', 400)

    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    if (!locationId) return err('Location ID is required', 400)

    const employeeId = searchParams.get('employeeId')
    const reason = (searchParams.get('reason') || 'normal') as 'normal' | 'comp' | 'void' | 'force'

    // Permission check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_ENTERTAINMENT)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Parse body if provided (allows passing reason in body instead of query param)
    let bodyReason = reason
    try {
      const body = await request.json()
      if (body?.reason) bodyReason = body.reason
    } catch {
      // No body or invalid JSON is fine
    }

    // Fetch the order item with full pricing config
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
        },
      },
    })

    if (!orderItem) {
      return notFound('Order item not found')
    }

    // Validate stop request
    const stopError = validateStopSession({
      orderLocationId: orderItem.order.locationId,
      requestLocationId: locationId,
    })
    if (stopError) {
      return err(stopError, 403)
    }

    if (!orderItem.blockTimeStartedAt) {
      return err('Session is not active', 400)
    }

    // Stop the session in a transaction
    const now = new Date()
    const txResult = await db.$transaction(async (tx) => {
      return stopSession(tx, {
        orderItemId,
        menuItemId: orderItem.menuItemId,
        reason: bodyReason,
        now,
        menuItem: orderItem.menuItem as any,
      })
    })

    if (txResult.alreadyProcessed) {
      return ok({
        success: true,
        alreadyProcessed: true,
        message: 'Session was already stopped',
      })
    }

    const { actualMinutes, calculatedCharge, breakdown, overtimeBreakdown, updatedMenuItem } = txResult

    // Fire-and-forget: sync to cloud
    void notifyDataChanged({ locationId, domain: 'events', action: 'updated', entityId: orderItemId })
    void pushUpstream()

    // Fire-and-forget: emit order event
    const eventType = (bodyReason === 'void' || bodyReason === 'comp') ? 'COMP_VOID_APPLIED' as const : 'ITEM_UPDATED' as const
    void emitOrderEvent(orderItem.order.locationId, orderItem.order.id, eventType, {
      lineItemId: orderItemId,
      price: calculatedCharge,
      blockTimeMinutes: orderItem.blockTimeMinutes,
      blockTimeStartedAt: 'CLEARED',
      blockTimeExpiresAt: now.toISOString(),
      actualMinutesUsed: actualMinutes,
      reason: bodyReason,
      ...(bodyReason === 'comp' ? { status: 'comped' } : {}),
      ...(bodyReason === 'void' ? { status: 'voided' } : {}),
    })

    // Fire-and-forget: socket updates
    const socketAction =
      bodyReason === 'comp'
        ? ('comped' as const)
        : bodyReason === 'void'
          ? ('voided' as const)
          : bodyReason === 'force'
            ? ('force_stopped' as const)
            : ('stopped' as const)

    void dispatchEntertainmentStatusChanged(orderItem.order.locationId, {
      itemId: orderItem.menuItemId,
      entertainmentStatus: 'available',
      currentOrderId: null,
      expiresAt: null,
    }, { async: true }).catch(err => log.warn({ err }, 'Socket dispatch failed'))

    void dispatchEntertainmentUpdate(orderItem.order.locationId, {
      sessionId: orderItemId,
      tableId: orderItem.menuItemId,
      tableName: orderItem.name || '',
      action: socketAction,
      expiresAt: null,
      startedAt: null,
    }, { async: true }).catch(err => log.warn({ err }, 'Socket dispatch failed'))

    // Auto-notify next waitlist entry
    void notifyNextWaitlistEntry(orderItem.order.locationId, orderItem.menuItemId, orderItem.name).catch(err =>
      log.warn({ err }, 'Waitlist notify failed')
    )

    // Audit log
    const auditAction =
      bodyReason === 'comp'
        ? 'entertainment_session_comped'
        : bodyReason === 'void'
          ? 'entertainment_session_voided'
          : bodyReason === 'force'
            ? 'entertainment_session_force_stopped'
            : 'entertainment_session_stopped'

    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: auditAction,
        entityType: 'order_item',
        entityId: orderItemId,
        details: {
          menuItemId: orderItem.menuItemId,
          itemName: orderItem.name,
          reason: bodyReason,
          actualMinutesUsed: actualMinutes,
          bookedMinutes: orderItem.blockTimeMinutes,
          finalCharge: calculatedCharge,
          overtimeCharge: overtimeBreakdown?.overtimeCharge || 0,
          overtimeMinutes: overtimeBreakdown?.overtimeMinutes || 0,
          orderId: orderItem.orderId,
        },
      },
    }).catch(err => console.error('[entertainment-sessions] Audit log failed:', err))

    // Build response message
    let message = ''
    if (bodyReason === 'comp') {
      message = `Session comped. ${actualMinutes} minutes used.`
    } else if (bodyReason === 'void') {
      message = `Session voided. ${actualMinutes} minutes used.`
    } else if (bodyReason === 'force') {
      message = `Session force-stopped. ${actualMinutes} minutes used. Charge: $${calculatedCharge.toFixed(2)}`
    } else {
      message = `Stopped session. ${actualMinutes} minutes used. Charge: $${calculatedCharge.toFixed(2)}`
    }

    return ok({
      success: true,
      reason: bodyReason,
      actualMinutesUsed: actualMinutes,
      charge: calculatedCharge,
      chargeBreakdown: breakdown || null,
      overtimeBreakdown: overtimeBreakdown || null,
      message,
      menuItem: updatedMenuItem,
    })
  } catch (error) {
    console.error('[entertainment-sessions-stop] Error:', error)
    return err('Failed to stop session', 500)
  }
})
